/**
 * Process-level error guards.
 *
 * program.parse() is synchronous, so a rejection escaping an async commander
 * action reaches neither the action's try/catch nor the import().catch() in
 * bin/codemie.js — Node then prints a raw stack trace (EPMCDME-14148).
 */

import { appendFileSync } from 'node:fs';
import chalk from 'chalk';
import { getErrorMessage } from './errors.js';
import { logger } from './logger.js';
import { sanitizeLogArgs } from './security.js';

/** logger writes through a WriteStream that process.exit() does not drain. */
function persistFatalSync(kind: string, payload: unknown): void {
  try {
    const logPath = logger.getLogFilePath();
    if (!logPath) {
      return;
    }

    const detail =
      payload instanceof Error && payload.stack
        ? payload.stack
        : getErrorMessage(payload);
    const [safeDetail] = sanitizeLogArgs(detail);

    appendFileSync(
      logPath,
      `[${new Date().toISOString()}] [FATAL] ${kind}: ${String(safeDetail)}\n`
    );
  } catch {
    // A logging failure must never mask the original fatal.
  }
}

function reportFatal(kind: string, payload: unknown): never {
  const message = getErrorMessage(payload);

  process.exitCode = 1;

  // Pass payload itself — logger unwraps .stack only from a real Error.
  logger.error(`${kind}: ${message}`, payload);
  persistFatalSync(kind, payload);

  console.error(chalk.red(`\n❌ ${message}\n`));
  process.exit(1);
}

let installed = false;

/**
 * Called from each bin/* entrypoint, never from the AgentCLI constructor —
 * constructing an AgentCLI must not mutate global process state (unit tests do).
 */
export function installProcessGuards(): void {
  if (installed) {
    return;
  }
  installed = true;

  process.on('unhandledRejection', (reason: unknown) => {
    reportFatal('Unhandled rejection', reason);
  });

  process.on('uncaughtException', (error: unknown) => {
    reportFatal('Uncaught exception', error);
  });
}
