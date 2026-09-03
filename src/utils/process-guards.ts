/**
 * Process-level error guards
 *
 * Commander actions are async, and `program.parse()` is synchronous, so a
 * rejection escaping an action reaches neither the action's try/catch nor the
 * import().catch() in bin/codemie.js. Without a net, Node's default handler
 * prints a raw stack trace. These guards are the last line of defence
 * (EPMCDME-14148); commands should still handle their own errors.
 */

import { appendFileSync } from 'node:fs';
import chalk from 'chalk';
import { getErrorMessage } from './errors.js';
import { logger } from './logger.js';
import { sanitizeLogArgs } from './security.js';

/**
 * Append the fatal detail synchronously.
 *
 * logger writes through an fs.WriteStream, whose write() is asynchronous;
 * process.exit() does not drain it, so on a cold stream the entry is lost
 * entirely. A fatal is exactly when the record matters most.
 */
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

  // Set first: if anything below exits early, the code is still non-zero.
  process.exitCode = 1;

  // Pass the payload itself — logger extracts .message/.stack only from a real
  // Error; an object literal would stringify to "[object Object]".
  logger.error(`${kind}: ${message}`, payload);
  persistFatalSync(kind, payload);

  // Console gets the actionable line only; the stack belongs in the log file.
  console.error(chalk.red(`\n❌ ${message}\n`));
  process.exit(1);
}

let installed = false;

/**
 * Register process-level handlers for unhandled rejections and uncaught
 * exceptions so they surface as a formatted message rather than a stack trace.
 *
 * Called from each bin/* entrypoint rather than from AgentCLI, so constructing
 * an AgentCLI never mutates global process state. Idempotent as a guard against
 * one process loading more than one entrypoint.
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
