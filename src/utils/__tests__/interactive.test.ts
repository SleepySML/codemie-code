import { describe, it, expect, afterEach } from 'vitest';

describe('isNonInteractiveEnvironment', () => {
  const originalIsTTY = process.stdin.isTTY;

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
  });

  it('should return true when process.stdin.isTTY is undefined (no TTY, e.g. piped/CI)', async () => {
    process.stdin.isTTY = undefined as unknown as true;

    const { isNonInteractiveEnvironment } = await import('../interactive.js');

    expect(isNonInteractiveEnvironment()).toBe(true);
  });

  it('should return true when process.stdin.isTTY is false', async () => {
    process.stdin.isTTY = false as unknown as true;

    const { isNonInteractiveEnvironment } = await import('../interactive.js');

    expect(isNonInteractiveEnvironment()).toBe(true);
  });

  it('should return false when process.stdin.isTTY is true (interactive terminal)', async () => {
    process.stdin.isTTY = true;

    const { isNonInteractiveEnvironment } = await import('../interactive.js');

    expect(isNonInteractiveEnvironment()).toBe(false);
  });
});

describe('isNonInteractiveOutput', () => {
  const originalStdin = process.stdin.isTTY;
  const originalStderr = process.stderr.isTTY;

  afterEach(() => {
    process.stdin.isTTY = originalStdin;
    process.stderr.isTTY = originalStderr;
  });

  it('should return true when process.stderr.isTTY is undefined (redirected output)', async () => {
    process.stderr.isTTY = undefined as unknown as true;

    const { isNonInteractiveOutput } = await import('../interactive.js');

    expect(isNonInteractiveOutput()).toBe(true);
  });

  it('should return false when process.stderr.isTTY is true (terminal output)', async () => {
    process.stderr.isTTY = true;

    const { isNonInteractiveOutput } = await import('../interactive.js');

    expect(isNonInteractiveOutput()).toBe(false);
  });

  // The two cases that motivate a separate predicate: input and output are
  // redirected independently, so the two must be able to disagree.
  it('should track stderr, not stdin, when only stdin is redirected', async () => {
    process.stdin.isTTY = false as unknown as true;
    process.stderr.isTTY = true;

    const { isNonInteractiveOutput, isNonInteractiveEnvironment } = await import(
      '../interactive.js'
    );

    expect(isNonInteractiveEnvironment()).toBe(true);
    expect(isNonInteractiveOutput()).toBe(false);
  });

  it('should track stderr, not stdin, when only output is redirected', async () => {
    process.stdin.isTTY = true;
    process.stderr.isTTY = false as unknown as true;

    const { isNonInteractiveOutput, isNonInteractiveEnvironment } = await import(
      '../interactive.js'
    );

    expect(isNonInteractiveEnvironment()).toBe(false);
    expect(isNonInteractiveOutput()).toBe(true);
  });
});
