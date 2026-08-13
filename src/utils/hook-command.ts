/**
 * Shared codemie hook-command path resolver.
 *
 * Claude Code / Gemini / codemie-code hooks invoke the `codemie` CLI. When the
 * hook shell's PATH does not contain the codemie bin directory (e.g. a
 * user-prefix install without admin rights), a bare `codemie hook` fails with
 * `codemie: command not found`. This module resolves an absolute, directly
 * invocable command prefix so hooks no longer depend on PATH.
 *
 * See EPMCDME-14035.
 */
import { getCommandPath } from './processes.js';

/**
 * Special characters that require the command path to be quoted before it is
 * embedded in a shell command string. Mirrors the class used in
 * BaseAgentAdapter for Windows command-path quoting.
 */
const NEEDS_QUOTING = /[ \t,;=()&|<>^%[\]{}]/;

function quoteIfNeeded(p: string): string {
  return NEEDS_QUOTING.test(p) && !p.startsWith('"') ? `"${p}"` : p;
}

function alwaysQuote(p: string): string {
  return p.startsWith('"') ? p : `"${p}"`;
}

/**
 * Resolve an absolute, directly-invocable command prefix for the codemie CLI.
 *
 * Preference order:
 * 1. PATH-resolved shim/symlink via `getCommandPath('codemie')` (directly
 *    executable on all platforms).
 * 2. The running entry `process.argv[1]` (the codemie.js being executed).
 * 3. The literal `codemie` (today's behavior — last resort).
 *
 * The result is quoted when it contains whitespace or shell-special characters.
 */
export async function resolveCodemieBinary(): Promise<string> {
  // Resolution must never throw — it runs in agent beforeRun/hook paths where a
  // failure would break launch. Any error degrades to the next fallback.
  try {
    const resolved = await getCommandPath('codemie');
    if (resolved) return quoteIfNeeded(resolved);
  } catch {
    // fall through to argv[1] / bare command
  }

  const argv1 = process.argv[1];
  if (argv1) {
    // On Windows a raw .js entry path is not directly invocable as a hook command
    // (cmd.exe needs a `node` prefix); on Unix argv[1] runs via its shebang.
    // Always quote both tokens here — a `node <script>` invocation must survive
    // spaces in either path (e.g. "C:\Program Files\nodejs\node.exe").
    if (process.platform === 'win32' && /\.[cm]?js$/i.test(argv1)) {
      return `${alwaysQuote(process.execPath)} ${alwaysQuote(argv1)}`;
    }
    return quoteIfNeeded(argv1);
  }

  return 'codemie';
}

/**
 * Rewrite a hook command's leading `codemie` token to `binary`.
 * Commands that are not the codemie CLI (or already absolute) are returned
 * unchanged.
 */
export function resolveHookCommand(command: string, binary: string): string {
  if (command === 'codemie') return binary;
  if (command.startsWith('codemie ')) return binary + command.slice('codemie'.length);
  return command;
}

/**
 * Recursively rewrite every string-valued `command` field found anywhere in a
 * hooks structure via {@link resolveHookCommand}. Shape-agnostic: it handles the
 * Claude/Gemini `{ EventName: [{ hooks: [{ command }] }] }` layout and any other
 * nesting without hardcoding it. Mutates in place; returns true if anything changed.
 */
export function rewriteHooksCommandTree(node: unknown, binary: string): boolean {
  if (Array.isArray(node)) {
    let changed = false;
    for (const item of node) {
      if (rewriteHooksCommandTree(item, binary)) changed = true;
    }
    return changed;
  }

  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    let changed = false;
    for (const [key, value] of Object.entries(record)) {
      if (key === 'command' && typeof value === 'string') {
        const next = resolveHookCommand(value, binary);
        if (next !== value) {
          record[key] = next;
          changed = true;
        }
      } else if (rewriteHooksCommandTree(value, binary)) {
        changed = true;
      }
    }
    return changed;
  }

  return false;
}
