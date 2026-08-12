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
  const resolved = await getCommandPath('codemie');
  if (resolved) return quoteIfNeeded(resolved);

  const argv1 = process.argv[1];
  if (argv1) return quoteIfNeeded(argv1);

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

interface HookLeaf {
  command?: unknown;
}
interface HookMatcherEntry {
  hooks?: unknown;
}

/**
 * Walk a Claude/Gemini hooks tree (`{ EventName: [{ hooks: [{ command }] }] }`)
 * and rewrite every string `command` via {@link resolveHookCommand}.
 * Mutates in place. Returns true if any command changed.
 */
export function rewriteHooksCommandTree(hooks: unknown, binary: string): boolean {
  if (!hooks || typeof hooks !== 'object') return false;

  let changed = false;
  for (const entries of Object.values(hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as HookMatcherEntry[]) {
      const inner = entry?.hooks;
      if (!Array.isArray(inner)) continue;
      for (const leaf of inner as HookLeaf[]) {
        if (typeof leaf.command === 'string') {
          const next = resolveHookCommand(leaf.command, binary);
          if (next !== leaf.command) {
            leaf.command = next;
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}
