import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAgentMock = vi.fn();
const restoreCliBinLinkMock = vi.fn();
const spinnerSucceedMock = vi.fn();
const spinnerFailMock = vi.fn();
const spinnerWarnMock = vi.fn();

vi.mock('../../../agents/registry.js', () => ({
  AgentRegistry: {
    getAgent: getAgentMock,
    getAllAgents: vi.fn(() => []),
  },
}));

vi.mock('../../../utils/cli-bin.js', () => ({
  restoreCliBinLink: restoreCliBinLinkMock,
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn(() => ({
      succeed: spinnerSucceedMock,
      fail: spinnerFailMock,
      warn: spinnerWarnMock,
    })),
  })),
}));

const warnOnceIfUntestedMock = vi.fn();

function makeAgent(overrides: Record<string, unknown>) {
  return {
    name: 'claude',
    displayName: 'Claude Code',
    description: 'Claude Code - AI coding agent by Anthropic',
    metadata: {},
    isInstalled: vi.fn().mockResolvedValue(false),
    install: vi.fn().mockResolvedValue(undefined),
    installVersion: vi.fn().mockResolvedValue('2.1.34'),
    getVersion: vi.fn().mockResolvedValue('2.1.34'),
    warnOnceIfUntested: warnOnceIfUntestedMock,
    ...overrides,
  };
}

describe('install command version selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('--supported routes to installVersion("latest")', async () => {
    const installVersion = vi.fn().mockResolvedValue('2.1.34');
    getAgentMock.mockReturnValue(makeAgent({ installVersion }));

    const { createInstallCommand } = await import('../install.js');
    const command = createInstallCommand();

    await command.parseAsync(['node', 'codemie', 'claude', '--supported']);

    expect(installVersion).toHaveBeenCalledWith('latest');
    expect(spinnerSucceedMock).toHaveBeenCalledWith('Claude Code v2.1.34 installed successfully');
  });

  it('default install (no version, no flag) calls agent.install() and does not resolve a supported version', async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    const installVersion = vi.fn();
    getAgentMock.mockReturnValue(
      makeAgent({
        install,
        installVersion,
        name: 'codex',
        displayName: 'OpenAI Codex CLI',
        getVersion: vi.fn().mockResolvedValue('0.143.0'),
      }),
    );

    const { createInstallCommand } = await import('../install.js');
    const command = createInstallCommand();

    await command.parseAsync(['node', 'codemie', 'codex']);

    expect(install).toHaveBeenCalledOnce();
    expect(installVersion).not.toHaveBeenCalled();
    expect(restoreCliBinLinkMock).toHaveBeenCalledOnce();
    expect(spinnerSucceedMock).toHaveBeenCalledWith('OpenAI Codex CLI v0.143.0 installed successfully');
  });

  it('uses the version returned by installVersion() for the success message', async () => {
    const installVersion = vi.fn().mockResolvedValue('2.1.34');
    const getVersion = vi.fn().mockResolvedValue('2.1.33'); // stale — must NOT appear in spinner
    getAgentMock.mockReturnValue(makeAgent({ installVersion, getVersion }));

    const { createInstallCommand } = await import('../install.js');
    const command = createInstallCommand();

    await command.parseAsync(['node', 'codemie', 'claude', '2.1.34']);

    expect(installVersion).toHaveBeenCalledWith('2.1.34');
    expect(spinnerSucceedMock).toHaveBeenCalledWith('Claude Code v2.1.34 installed successfully');
  });

  it('warns when detected version does not match requested version (stale PATH)', async () => {
    const installVersion = vi.fn().mockResolvedValue('2.1.33');
    const getVersion = vi.fn().mockResolvedValue('2.1.33');
    getAgentMock.mockReturnValue(makeAgent({ installVersion, getVersion }));

    const { createInstallCommand } = await import('../install.js');
    const command = createInstallCommand();

    await command.parseAsync(['node', 'codemie', 'claude', '2.1.34']);

    expect(spinnerSucceedMock).not.toHaveBeenCalled();
    expect(spinnerWarnMock).toHaveBeenCalledTimes(1);
    const [actualArg] = spinnerWarnMock.mock.calls[0];
    expect(actualArg).toContain('v2.1.33');
    expect(actualArg).toContain('v2.1.34');
    expect(actualArg).toContain('terminal restart');
  });

  it('falls back to getVersion() when installVersion() returns null', async () => {
    const installVersion = vi.fn().mockResolvedValue(null);
    const getVersion = vi.fn().mockResolvedValue('2.1.34');
    getAgentMock.mockReturnValue(makeAgent({ installVersion, getVersion }));

    const { createInstallCommand } = await import('../install.js');
    const command = createInstallCommand();

    await command.parseAsync(['node', 'codemie', 'claude', '2.1.34']);

    expect(getVersion).toHaveBeenCalled(); // fallback path exercised
    expect(spinnerSucceedMock).toHaveBeenCalledWith('Claude Code v2.1.34 installed successfully');
  });

  it('does not read metadata.supportedVersion or call checkVersionCompatibility', async () => {
    const checkVersionCompatibility = vi.fn();
    const install = vi.fn().mockResolvedValue(undefined);
    getAgentMock.mockReturnValue(makeAgent({ install, checkVersionCompatibility }));

    const { createInstallCommand } = await import('../install.js');
    const command = createInstallCommand();

    await command.parseAsync(['node', 'codemie', 'claude']);

    expect(checkVersionCompatibility).not.toHaveBeenCalled();
  });

  it('calls agent.warnOnceIfUntested after a successful install to record the marker', async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    getAgentMock.mockReturnValue(makeAgent({ install }));

    const { createInstallCommand } = await import('../install.js');
    const command = createInstallCommand();

    await command.parseAsync(['node', 'codemie', 'claude']);

    expect(warnOnceIfUntestedMock).toHaveBeenCalledOnce();
  });
});
