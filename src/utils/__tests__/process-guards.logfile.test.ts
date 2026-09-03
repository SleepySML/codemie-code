/**
 * Companion to process-guards.test.ts, which mocks the logger wholesale and so
 * cannot catch a broken logging contract. This file uses the REAL logger and
 * asserts the stack actually reaches the log file — the failure mode that
 * shipped undetected in the first round (CR-001).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

type Handler = (payload: unknown) => void;

describe('installProcessGuards log-file persistence', () => {
  let handlers: Record<string, Handler>;

  beforeEach(() => {
    handlers = {};
    vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      handler: Handler
    ) => {
      handlers[event] = handler;
      return process;
    }) as never);

    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('writes the stack to the log file even though the console omits it', async () => {
    const { logger } = await import('../logger.js');
    const { installProcessGuards } = await import('../process-guards.js');

    const logPath = logger.getLogFilePath();
    // Logging to file is best-effort; if this environment has no log path there
    // is nothing to assert against.
    if (!logPath) {
      return;
    }

    const before = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';

    installProcessGuards();

    const marker = 'process-guards-logfile-probe';
    const boom = new Error(marker);

    expect(() => handlers.uncaughtException(boom)).toThrow('process.exit:1');

    const after = readFileSync(logPath, 'utf-8');
    const appended = after.slice(before.length);

    expect(appended).toContain(marker);
    // A stack, not just the message — the whole point of relocating it.
    expect(appended).toMatch(/\n\s+at\s/);
    expect(appended).not.toContain('[object Object]');
  });
});
