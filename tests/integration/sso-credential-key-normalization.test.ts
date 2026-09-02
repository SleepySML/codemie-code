/**
 * Regression tests for EPMCDME-14132 — SSO credential storage-key normalization.
 *
 * keytar is mocked with an in-memory map. retrieveSSOCredentials consults the real
 * OS keychain before the file store, so an unmocked run can pass against unfixed
 * code purely on a stale keychain entry left by an earlier run.
 *
 * setupTestIsolation() is deliberately not used: it sets CODEMIE_HOME in beforeAll,
 * after security.ts has frozen CREDENTIALS_DIR at module scope. The vitest project
 * config already points CODEMIE_HOME at a temp dir before import.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdir } from 'fs/promises';

const keychain = new Map<string, string>();

vi.mock('keytar', () => ({
  setPassword: vi.fn(async (service: string, account: string, password: string) => {
    keychain.set(`${service}:${account}`, password);
  }),
  getPassword: vi.fn(async (service: string, account: string) =>
    keychain.get(`${service}:${account}`) ?? null),
  deletePassword: vi.fn(async (service: string, account: string) =>
    keychain.delete(`${service}:${account}`)),
}));

import { CredentialStore } from '../../src/utils/security.js';
import { CodeMieSSO } from '../../src/providers/plugins/sso/sso.auth.js';
import { getCodemiePath } from '../../src/utils/paths.js';
import type { SSOCredentials } from '../../src/providers/core/types.js';

const BASE_URL = 'https://codemie-14132.example.com';
const API_URL = `${BASE_URL}/code-assistant-api`;

function credentials(): SSOCredentials {
  return {
    cookies: { codemie_access_token: 'test-token' },
    apiUrl: API_URL,
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

async function listCredentialFiles(): Promise<string[]> {
  try {
    return (await readdir(getCodemiePath('credentials'))).sort();
  } catch {
    return [];
  }
}

describe('EPMCDME-14132: credential storage key is path-independent', () => {
  beforeEach(async () => {
    keychain.clear();
    const sso = new CodeMieSSO();
    await sso.clearStoredCredentials(API_URL);
    await sso.clearStoredCredentials(BASE_URL);
  });

  it('derives the same storage key from the API URL and the bare base URL', async () => {
    const store = CredentialStore.getInstance();

    const before = await listCredentialFiles();
    await store.storeSSOCredentials(credentials(), API_URL);
    const afterApiUrl = await listCredentialFiles();
    await store.storeSSOCredentials(credentials(), BASE_URL);
    const afterBaseUrl = await listCredentialFiles();

    expect(afterApiUrl.length - before.length).toBe(1);
    expect(afterBaseUrl).toEqual(afterApiUrl);
  });

  it('finds credentials stored under a path-bearing URL (the reported bug)', async () => {
    await CredentialStore.getInstance().storeSSOCredentials(credentials(), API_URL);

    const found = await new CodeMieSSO().getStoredCredentials(API_URL);

    expect(found).not.toBeNull();
    expect(found?.cookies.codemie_access_token).toBe('test-token');
  });

  it('clears credentials stored under the base URL when given the API URL', async () => {
    await CredentialStore.getInstance().storeSSOCredentials(credentials(), BASE_URL);
    expect(await new CodeMieSSO().getStoredCredentials(API_URL)).not.toBeNull();

    await new CodeMieSSO().clearStoredCredentials(API_URL);

    expect(await new CodeMieSSO().getStoredCredentials(API_URL)).toBeNull();
  });
});
