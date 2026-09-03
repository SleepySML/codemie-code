import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const oraInstance = {
  text: '',
  start: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
};
const oraFactory = vi.fn(() => {
  oraInstance.start.mockReturnValue(oraInstance);
  return oraInstance;
});

vi.mock('ora', () => ({ default: oraFactory }));

vi.mock('../interactive.js', () => ({
  isNonInteractiveEnvironment: vi.fn(),
}));

vi.mock('../config.js', () => ({
  ConfigLoader: { load: vi.fn() },
}));

vi.mock('../logger.js', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const getStoredCredentials = vi.fn();
vi.mock('../../providers/plugins/sso/sso.auth.js', () => ({
  CodeMieSSO: class {
    getStoredCredentials = getStoredCredentials;
  },
}));

describe('getCodemieClient spinner behaviour', () => {
  beforeEach(() => {
    oraFactory.mockClear();
    oraInstance.start.mockClear();
    getStoredCredentials.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('does not start a spinner when the environment is non-interactive', async () => {
    const { isNonInteractiveEnvironment } = await import('../interactive.js');
    const { ConfigLoader } = await import('../config.js');
    const { ConfigurationError } = await import('../errors.js');

    vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
    vi.mocked(ConfigLoader.load).mockResolvedValue({
      codeMieUrl: 'https://example.test',
    } as never);
    getStoredCredentials.mockResolvedValue(null);

    const { getCodemieClient } = await import('../sdk-client.js');

    await expect(getCodemieClient()).rejects.toThrow(ConfigurationError);
    expect(oraFactory).not.toHaveBeenCalled();
  });

  it('still starts a spinner when interactive and not explicitly quiet', async () => {
    const { isNonInteractiveEnvironment } = await import('../interactive.js');
    const { ConfigLoader } = await import('../config.js');
    const { ConfigurationError } = await import('../errors.js');

    vi.mocked(isNonInteractiveEnvironment).mockReturnValue(false);
    vi.mocked(ConfigLoader.load).mockResolvedValue({
      codeMieUrl: 'https://example.test',
    } as never);
    getStoredCredentials.mockResolvedValue(null);

    const { getCodemieClient } = await import('../sdk-client.js');

    await expect(getCodemieClient()).rejects.toThrow(ConfigurationError);
    expect(oraFactory).toHaveBeenCalled();
  });
});
