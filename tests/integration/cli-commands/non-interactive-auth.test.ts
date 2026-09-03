/**
 * EPMCDME-14148 — non-interactive SSO failure must fail cleanly.
 *
 * End-to-end proof of the acceptance criterion: with no valid SSO session and
 * a non-TTY stdin, the CLI exits non-zero with actionable remediation and
 * without a raw stack trace.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIRunner } from '../../helpers/cli-runner.js';

describe('non-interactive SSO auth failure', () => {
  const runner = new CLIRunner();
  let isolatedHome: string;

  beforeAll(() => {
    // An empty home guarantees "no valid SSO session" without touching the
    // developer's real ~/.codemie credentials.
    isolatedHome = mkdtempSync(join(tmpdir(), 'codemie-14148-'));
  });

  afterAll(() => {
    rmSync(isolatedHome, { recursive: true, force: true });
  });

  const EXPECTED_MESSAGE =
    'SSO authentication required. Please run "codemie setup" with SSO provider first.';

  function runWithoutTty(command: string) {
    const result = runner.runSilent(command, {
      env: { ...process.env, CODEMIE_HOME: isolatedHome },
      // stdin from 'ignore' is not a TTY, which is the condition under test.
      stdio: ['ignore', 'pipe', 'pipe'],
      // runSilent wraps execSync, which blocks the worker synchronously —
      // Vitest's testTimeout cannot interrupt it. Without this, a regression to
      // the original hang would wedge CI instead of failing here.
      timeout: 15_000,
    });

    // On ETIMEDOUT execSync reports status: null, which runSilent collapses to
    // exitCode 1 — and stderr already holds whatever was printed before the
    // block. Without this guard a genuine 15s hang passes every assertion
    // below, including the one named for it.
    expect(result.timedOut ?? false).toBe(false);

    return { ...result, combined: `${result.output}\n${result.error ?? ''}` };
  }

  it('exits non-zero instead of hanging on a re-authentication prompt', () => {
    const result = runWithoutTty('sdk assistants list');

    expect(result.exitCode).not.toBe(0);
  });

  it('names the remediation the user should run', () => {
    const result = runWithoutTty('sdk assistants list');

    // Asserted verbatim: a loose /codemie setup/ match is also satisfied by
    // unrelated setup advice from other failure paths.
    expect(result.combined).toContain(EXPECTED_MESSAGE);
  });

  it('sends the diagnostic to stderr and keeps it off stdout', () => {
    const result = runWithoutTty('sdk assistants list');

    expect(result.error ?? '').toContain(EXPECTED_MESSAGE);
    expect(result.output).not.toContain(EXPECTED_MESSAGE);
  });

  it('does not print a raw stack trace', () => {
    const result = runWithoutTty('sdk assistants list');

    expect(result.combined).not.toMatch(/^\s+at\s+/m);
    expect(result.combined).not.toContain('ConfigurationError:');
    expect(result.combined).not.toMatch(/Node\.js v\d/);
  });
});
