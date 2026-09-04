/** EPMCDME-14148 — non-interactive SSO failure must exit cleanly, end to end. */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLIRunner } from '../../helpers/cli-runner.js';

describe('non-interactive SSO auth failure', () => {
  const runner = new CLIRunner();
  let isolatedHome: string;

  beforeAll(() => {
    // Empty home = "no valid SSO session", without touching the real ~/.codemie.
    isolatedHome = mkdtempSync(join(tmpdir(), 'codemie-14148-'));
  });

  afterAll(() => {
    rmSync(isolatedHome, { recursive: true, force: true });
  });

  const EXPECTED_MESSAGE =
    'SSO authentication required. Please run "codemie setup" with SSO provider first.';

  function runWithoutTty(command: string) {
    const startedAt = Date.now();
    const result = runner.runSilent(command, {
      env: { ...process.env, CODEMIE_HOME: isolatedHome },
      // 'ignore' stdin is not a TTY — the condition under test.
      stdio: ['ignore', 'pipe', 'pipe'],
      // execSync blocks the worker, so Vitest's testTimeout cannot interrupt a hang.
      timeout: 15_000,
    });

    // Without these two, a hang satisfies every assertion below — including the
    // one named for it: ETIMEDOUT yields status null, which collapses to exit 1,
    // and stderr already holds what was printed before the block.
    expect(result.timedOut ?? false).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(5_000);

    return { ...result, combined: `${result.output}\n${result.error ?? ''}` };
  }

  it('exits non-zero instead of hanging on a re-authentication prompt', () => {
    const result = runWithoutTty('sdk assistants list');

    expect(result.exitCode).not.toBe(0);
  });

  it('names the remediation the user should run', () => {
    const result = runWithoutTty('sdk assistants list');

    // Verbatim: a loose /codemie setup/ also matches other failure paths.
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
