/**
 * Non-interactive environment detection
 *
 * Single source of truth for "can we prompt the user right now?".
 * Used to guard interactive prompts (e.g. inquirer) that would otherwise
 * hang or crash (ERR_USE_AFTER_CLOSE) when no TTY is attached to stdin
 * (CI, automation, piped input).
 */

/**
 * Returns true when the current process cannot receive interactive input,
 * i.e. process.stdin is not a TTY.
 */
export function isNonInteractiveEnvironment(): boolean {
  return !process.stdin.isTTY;
}

/**
 * Returns true when progress output would not be rendered to a terminal.
 *
 * Deliberately separate from isNonInteractiveEnvironment(): input and output
 * can be redirected independently. A spinner is an output concern — ora writes
 * to stderr — so gating it on stdin both suppresses it for a terminal user who
 * merely redirects stdin, and fails to suppress it for `cmd > log 2>&1`, which
 * is the case that fills captured logs with cursor-control escapes.
 */
export function isNonInteractiveOutput(): boolean {
  return !process.stderr.isTTY;
}
