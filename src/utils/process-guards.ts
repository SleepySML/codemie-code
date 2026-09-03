/**
 * Process-level error guards
 *
 * Commander actions are async, and `program.parse()` is synchronous, so a
 * rejection escaping an action reaches neither the action's try/catch nor the
 * import().catch() in bin/codemie.js. Without a net, Node's default handler
 * prints a raw stack trace. These guards are the last line of defence
 * (EPMCDME-14148); commands should still handle their own errors.
 */

import chalk from 'chalk';
import { getErrorMessage } from './errors.js';
import { logger } from './logger.js';

function reportFatal(kind: string, payload: unknown): never {
  const message = getErrorMessage(payload);

  // Full detail, stack included, goes to the log file only.
  logger.error(`${kind}: ${message}`, {
    stack: payload instanceof Error ? payload.stack : undefined,
  });

  console.error(chalk.red(`\n❌ ${message}\n`));
  process.exit(1);
}

/**
 * Register process-level handlers for unhandled rejections and uncaught
 * exceptions so they surface as a formatted message rather than a stack trace.
 */
export function installProcessGuards(): void {
  process.on('unhandledRejection', (reason: unknown) => {
    reportFatal('Unhandled rejection', reason);
  });

  process.on('uncaughtException', (error: unknown) => {
    reportFatal('Uncaught exception', error);
  });
}
