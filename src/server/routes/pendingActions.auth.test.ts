import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createMutableAuthMock } from '../../../test/helpers/authFixture.js';

const {
  createContextClient, listOpenActions, decideAction
} = vi.hoisted(() => ({
  createContextClient: vi.fn(),
  listOpenActions: vi.fn(),
  decideAction: vi.fn()
}));

vi.mock('@supabase/server/core', () => ({ createContextClient }));
vi.mock('../../approvals/pendingStore.js', () => ({ listOpenActions }));
vi.mock('../../approvals/service.js', () => ({ decideAction }));

import { installAuthentication } from './auth.js';
import { pendingActionsRoutes } from './pendingActions.js';

const authMock = createMutableAuthMock({ role: 'admin' });
const actionId = '7b0f1c1e-3c0a-4d3e-9a52-0b5f3b6a1c11';
const bearer = { authorization: 'Bearer synthetic-approval-access-token' };
const apps: FastifyInstance[] = [];

async function createApp() {
  const app = Fastify();
  apps.push(app);
  installAuthentication(app);
  await app.register(pendingActionsRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://synthetic-project.supabase.co');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'synthetic-publishable-key');
  vi.clearAllMocks();
  authMock.setIdentity({ role: 'admin' });
  createContextClient.mockReturnValue({ auth: authMock.auth });
  listOpenActions.mockResolvedValue([]);
  decideAction.mockResolvedValue({ outcome: 'executed', result: 'synthetic-only' });
});

afterAll(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.unstubAllEnvs();
});

describe('real administrator guard for pending approval actions', () => {
  it('rejects missing or malformed bearer credentials before reaching the approval service', async () => {
    const app = await createApp();
    const noToken = await app.inject({
      method: 'POST', url: `/api/actions/${actionId}/approve`
    });
    const malformed = await app.inject({
      method: 'POST', url: `/api/actions/${actionId}/approve`,
      headers: { authorization: 'Basic not-a-bearer' }
    });
    expect(noToken.statusCode).toBe(401);
    expect(malformed.statusCode).toBe(401);
    expect(authMock.getUser).not.toHaveBeenCalled();
    expect(decideAction).not.toHaveBeenCalled();
  });

  it('rejects a verified member even when editable user metadata claims admin', async () => {
    authMock.setIdentity({ role: 'user', userMetadataRole: 'admin' });
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: `/api/actions/${actionId}/approve`, headers: bearer
    });
    expect(response.statusCode).toBe(403);
    expect(decideAction).not.toHaveBeenCalled();
  });

  it('rejects a valid identity when Supabase claims verification fails', async () => {
    authMock.setIdentity({ role: 'admin', claimsErrorStatus: 401, claimsErrorMessage: 'Invalid fixture claims' });
    const app = await createApp();
    const response = await app.inject({ method: 'POST', url: `/api/actions/${actionId}/approve`, headers: bearer });
    expect(response.statusCode).toBe(401);
    expect(listOpenActions).not.toHaveBeenCalled();
    expect(decideAction).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired token before reaching pending-action handlers', async () => {
    authMock.setIdentity({ role: null, invalidStatus: 401, invalidMessage: 'JWT expired' });
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: `/api/actions/${actionId}/approve`, headers: bearer
    });
    expect(response.statusCode).toBe(401);
    expect(listOpenActions).not.toHaveBeenCalled();
    expect(decideAction).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'throws'] as const)(
    'fails closed when the authenticated identity provider %s',
    async failure => {
      if (failure === 'throws') {
        authMock.getUser.mockRejectedValue(new Error('synthetic auth provider outage'));
      } else {
        authMock.getUser.mockResolvedValue({
          data: { user: null },
          error: { status: 503, message: 'synthetic auth provider unavailable' }
        });
      }
      const app = await createApp();
      const response = await app.inject({
        method: 'POST', url: `/api/actions/${actionId}/approve`, headers: bearer
      });
      expect(response.statusCode).toBe(503);
      expect(decideAction).not.toHaveBeenCalled();
    }
  );

  it('uses only the Supabase-verified administrator identity to decide the pending action', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST', url: `/api/actions/${actionId}/approve`, headers: bearer
    });
    expect(response.statusCode).toBe(200);
    expect(decideAction).toHaveBeenCalledExactlyOnceWith(actionId, 'verified-admin-id', true);
    expect(response.json()).toEqual({ status: 'executed', result: 'synthetic-only' });
  });
});
