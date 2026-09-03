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

  function runWithoutTty(command: string) {
    const result = runner.runSilent(command, {
      env: { ...process.env, CODEMIE_HOME: isolatedHome },
      // stdin from 'ignore' is not a TTY, which is the condition under test.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ...result, combined: `${result.output}\n${result.error ?? ''}` };
  }

  it('exits non-zero instead of hanging on a re-authentication prompt', () => {
    const result = runWithoutTty('sdk assistants list');

    expect(result.exitCode).not.toBe(0);
  });

  it('names the remediation the user should run', () => {
    const result = runWithoutTty('sdk assistants list');

    expect(result.combined).toMatch(/codemie setup/);
  });

  it('does not print a raw stack trace', () => {
    const result = runWithoutTty('sdk assistants list');

    expect(result.combined).not.toMatch(/^\s+at\s+/m);
    expect(result.combined).not.toContain('ConfigurationError:');
    expect(result.combined).not.toMatch(/Node\.js v\d/);
  });
});
