/**
 * Claude Request Normalizer Plugin
 * Priority: 14 (runs before RequestSanitizer at 15)
 *
 * Normalizes Claude API requests to match model-specific requirements. Every
 * model-specific decision is driven by a single source of truth —
 * MODEL_CAPABILITY_TABLE — rather than scattered per-behavior regexes:
 *
 * 1. `thinking: 'none'`  → strip the thinking field entirely (models that reject
 *    it with HTTP 400, e.g. claude-haiku-3-5 / 4-5).
 * 2. `thinking: 'adaptive'` → transform `thinking.type` "enabled" into
 *    { type: "adaptive" } + output_config.effort; "disabled" is preserved or
 *    deleted per `preserveDisabledThinking` (e.g. claude-opus-4-7+, claude-sonnet-5).
 * 3. `sampling: false` → strip temperature / top_p / top_k (e.g. claude-sonnet-5).
 * 4. `effort: false` → strip output_config.effort and any top-level effort, so a
 *    model that rejects it (e.g. claude-4-5-sonnet) does not 400 with
 *    "This model does not support the effort parameter".
 *
 * Problem: Claude Code sends `thinking: { type: "enabled", budget_tokens: N }`
 * and, from its `--effort` flag, an `effort` parameter — neither of which every
 * model accepts.
 *
 * Scope: Enabled for codemie-claude (Claude Code via SSO proxy), codemie-copilot
 * (GitHub Copilot CLI via BYOK Anthropic shape), and claude-desktop (Desktop 3P mode).
 *
 * To add or change model support: add/edit a row in MODEL_CAPABILITY_TABLE. The
 * handlers below read the resolved capabilities — they never test model names.
 */

import { ProxyPlugin, PluginContext, ProxyInterceptor } from './types.js';
import { ProxyContext } from '../proxy-types.js';
import { logger } from '../../../../../utils/logger.js';

/**
 * How a model handles the `thinking` field:
 * - `standard`  — leave it untouched (legacy models, e.g. claude-4-5-sonnet).
 * - `none`      — the model rejects thinking; strip it.
 * - `adaptive`  — the model requires the adaptive thinking API + output_config.effort.
 */
type ThinkingMode = 'standard' | 'none' | 'adaptive';

/**
 * Per-model normalization capabilities — the single source of truth for every
 * model-specific decision this plugin makes.
 */
interface ModelCapabilities {
  /** How the model handles the `thinking` field. */
  thinking: ThinkingMode;
  /** Whether the model accepts the effort parameter (output_config.effort / top-level effort). */
  effort: boolean;
  /** Whether the model accepts sampling parameters (temperature / top_p / top_k). */
  sampling: boolean;
  /** Adaptive models only: keep `thinking.type: "disabled"` instead of deleting it. */
  preserveDisabledThinking: boolean;
}

/**
 * Applied when no MODEL_CAPABILITY_TABLE row matches: the model handles thinking
 * the legacy way, does not support effort, and accepts sampling params.
 */
const DEFAULT_CAPABILITIES: ModelCapabilities = {
  thinking: 'standard',
  effort: false,
  sampling: true,
  preserveDisabledThinking: false,
};

/**
 * Model-name pattern → capabilities. First match wins. Extend this table as
 * Anthropic migrates additional models — see EPMCDME-11821 / EPMCDME-14035.
 * Patterns use `(?:[^0-9]|$)` after the version so e.g. `4-7` does not match `4-70`.
 */
const MODEL_CAPABILITY_TABLE: ReadonlyArray<{ pattern: RegExp; capabilities: ModelCapabilities }> = [
  {
    // claude-haiku-3-5 / 4-5 (+ date-tagged): no extended thinking at all.
    pattern: /claude-haiku-(3-5|4-5)(?:[^0-9]|$)/i,
    capabilities: { thinking: 'none', effort: false, sampling: true, preserveDisabledThinking: false },
  },
  {
    // claude-opus-4-7/8/9 (+ date-tagged; excludes 4-70+): adaptive thinking + effort.
    pattern: /claude-opus-4-[7-9](?:[^0-9]|$)/i,
    capabilities: { thinking: 'adaptive', effort: true, sampling: true, preserveDisabledThinking: false },
  },
  {
    // claude-sonnet-5 (+ date-tagged): adaptive thinking + effort; rejects manual
    // sampling params; keeps thinking.type="disabled".
    pattern: /claude-sonnet-5(?:[^0-9]|$)/i,
    capabilities: { thinking: 'adaptive', effort: true, sampling: false, preserveDisabledThinking: true },
  },
];

function capabilitiesFor(model: string): ModelCapabilities {
  for (const entry of MODEL_CAPABILITY_TABLE) {
    if (entry.pattern.test(model)) return entry.capabilities;
  }
  return DEFAULT_CAPABILITIES;
}

/**
 * Map legacy budget_tokens to the closest output_config.effort level.
 *
 * budget_tokens was the maximum token budget for thinking in the old API.
 * effort is a coarser control in the new API: low / medium / high.
 */
function budgetTokensToEffort(budgetTokens: unknown): 'low' | 'medium' | 'high' {
  const tokens = typeof budgetTokens === 'number' ? budgetTokens : 0;
  if (tokens <= 2048) return 'low';
  if (tokens <= 8192) return 'medium';
  return 'high';
}

/**
 * Handler: normalize the `thinking` field per the model's ThinkingMode.
 * Only called when `body.thinking` is present. Returns true if the body changed.
 */
function handleThinkingField(body: any, caps: ModelCapabilities, model: string): boolean {
  if (caps.thinking === 'none') {
    delete body.thinking;
    logger.debug(`[claude-request-normalizer] Stripped thinking field for unsupported model: ${model}`);
    return true;
  }

  if (caps.thinking === 'adaptive') {
    const thinkingType = body.thinking?.type;
    if (thinkingType !== 'enabled' && thinkingType !== 'disabled') {
      return false;
    }

    if (thinkingType === 'enabled') {
      const effort = budgetTokensToEffort(body.thinking.budget_tokens);
      body.thinking = { type: 'adaptive' };

      if (!body.output_config?.effort) {
        body.output_config = { ...(body.output_config ?? {}), effort };
      }

      logger.debug(
        `[claude-request-normalizer] Transformed thinking: "enabled" → "adaptive", effort="${effort}" for model: ${model}`
      );
      return true;
    }

    // thinkingType === 'disabled'
    if (caps.preserveDisabledThinking) {
      logger.debug(`[claude-request-normalizer] Preserved thinking.type="disabled" for model: ${model}`);
      return false;
    }

    delete body.thinking;
    logger.debug(`[claude-request-normalizer] Removed unsupported thinking.type="disabled" for model: ${model}`);
    return true;
  }

  // 'standard' — leave the thinking field untouched.
  return false;
}

/**
 * Handler: strips the `effort` parameter for models whose capabilities say they
 * do not support it. Newer Claude Code translates its `--effort` CLI flag into
 * `output_config.effort` (or a top-level `effort`); models like claude-4-5-sonnet
 * reject it with HTTP 400. Returns true if anything was stripped.
 */
function handleUnsupportedEffort(body: any, caps: ModelCapabilities, model: string): boolean {
  if (caps.effort) {
    return false;
  }

  let stripped = false;

  const outputConfig = body.output_config;
  if (outputConfig && typeof outputConfig === 'object' && 'effort' in outputConfig) {
    delete outputConfig.effort;
    stripped = true;
    if (Object.keys(outputConfig).length === 0) {
      delete body.output_config;
    }
  }

  if ('effort' in body) {
    delete body.effort;
    stripped = true;
  }

  if (stripped) {
    logger.debug(`[claude-request-normalizer] Stripped unsupported effort parameter for model: ${model}`);
  }
  return stripped;
}

/**
 * Handler: strips deprecated sampling params for models that reject them.
 * Returns true if anything was stripped.
 */
function handleDeprecatedSamplingParams(body: any, caps: ModelCapabilities, model: string): boolean {
  if (caps.sampling) {
    return false;
  }

  const stripped: string[] = [];
  for (const key of ['temperature', 'top_p', 'top_k'] as const) {
    if (key in body) {
      delete body[key];
      stripped.push(key);
    }
  }

  if (stripped.length === 0) {
    return false;
  }

  logger.debug(
    `[claude-request-normalizer] Stripped deprecated sampling params for model ${model}: ${stripped.join(', ')}`
  );
  return true;
}

/** Agents whose Claude API requests need thinking normalization */
const ALLOWED_AGENTS = ['codemie-claude', 'codemie-copilot', 'claude-desktop'];

export class ClaudeRequestNormalizerPlugin implements ProxyPlugin {
  id = '@codemie/proxy-claude-request-normalizer';
  name = 'Claude Request Normalizer';
  version = '1.0.0';
  priority = 14; // Before RequestSanitizer (15)

  async createInterceptor(context: PluginContext): Promise<ProxyInterceptor> {
    const clientType = context.config.clientType;
    if (!clientType || !ALLOWED_AGENTS.includes(clientType)) {
      throw new Error(`Plugin disabled for agent: ${clientType}`);
    }
    // Pass the configured model as a fallback for requests that omit body.model
    const configModel = context.config.model;
    return new ClaudeRequestNormalizerInterceptor(configModel);
  }
}

class ClaudeRequestNormalizerInterceptor implements ProxyInterceptor {
  name = 'claude-request-normalizer';

  constructor(private readonly configModel?: string) {}

  async onRequest(context: ProxyContext): Promise<void> {
    if (!context.requestBody || !context.headers['content-type']?.includes('application/json')) {
      return;
    }

    try {
      const bodyStr = context.requestBody.toString('utf-8');
      const body = JSON.parse(bodyStr);

      const model = (typeof body.model === 'string' && body.model) || this.configModel || '';
      if (!model) {
        return;
      }

      const caps = capabilitiesFor(model);

      const modifiedBySampling = handleDeprecatedSamplingParams(body, caps, model);

      // Runs regardless of body.thinking — Claude Code can send `effort` without
      // a thinking field, so this must not sit behind the thinking guard below.
      const modifiedByEffort = handleUnsupportedEffort(body, caps, model);

      let modifiedByThinking = false;
      if (body.thinking) {
        modifiedByThinking = handleThinkingField(body, caps, model);
      }

      if (modifiedBySampling || modifiedByEffort || modifiedByThinking) {
        const newBodyStr = JSON.stringify(body);
        context.requestBody = Buffer.from(newBodyStr, 'utf-8');
        context.headers['content-length'] = String(context.requestBody.length);
      }
    } catch {
      // Not valid JSON or unexpected structure — pass through unchanged
    }
  }
}
