import { vi } from 'vitest';

export type FixtureRole = 'user' | 'admin';

export interface FixtureIdentity {
  id: string;
  email: string;
  is_anonymous: false;
  app_metadata: { role: FixtureRole | null };
  user_metadata?: { role?: FixtureRole };
}

export interface AuthFixtureOptions {
  role?: FixtureRole | null;
  userId?: string;
  aal?: 'aal1' | 'aal2';
  userMetadataRole?: FixtureRole;
  invalidStatus?: number;
  invalidMessage?: string;
  claimsErrorStatus?: number;
  claimsErrorMessage?: string;
}

const DEFAULT_IDENTITIES: Record<FixtureRole, Omit<FixtureIdentity, 'user_metadata'>> = {
  user: {
    id: 'verified-user-id',
    email: 'member@ryanai.local',
    is_anonymous: false,
    app_metadata: { role: 'user' },
  },
  admin: {
    id: 'verified-admin-id',
    email: 'admin@ryanai.local',
    is_anonymous: false,
    app_metadata: { role: 'admin' },
  },
};

export function createFixtureIdentity(
  role: FixtureRole,
  userId?: string,
  userMetadataRole?: FixtureRole,
): FixtureIdentity {
  const base = DEFAULT_IDENTITIES[role];
  return {
    ...base,
    id: userId ?? base.id,
    ...(userMetadataRole ? { user_metadata: { role: userMetadataRole } } : {}),
  };
}

export function resolveTokenRole(token?: string | null): FixtureRole | null {
  if (token === 'fixture-user') return 'user';
  if (token === 'fixture-admin') return 'admin';
  return null;
}

/** Builds getUser/getClaims responses from one shared verified identity. */
export function buildAuthResponses(options: AuthFixtureOptions = {}) {
  const {
    role = 'admin',
    userId,
    aal = 'aal2',
    userMetadataRole,
    invalidStatus = 401,
    invalidMessage = 'Invalid fixture token',
    claimsErrorStatus,
    claimsErrorMessage = 'Invalid fixture claims',
  } = options;

  if (!role) {
    return {
      userResponse: { data: { user: null }, error: null },
      claimsResponse: {
        data: { claims: null },
        error: { status: invalidStatus, message: invalidMessage },
      },
    };
  }

  const user = createFixtureIdentity(role, userId, userMetadataRole);
  if (claimsErrorStatus !== undefined) {
    return {
      userResponse: { data: { user }, error: null },
      claimsResponse: {
        data: { claims: null },
        error: { status: claimsErrorStatus, message: claimsErrorMessage },
      },
    };
  }

  return {
    userResponse: { data: { user }, error: null },
    claimsResponse: {
      data: { claims: { sub: user.id, aal } },
      error: null,
    },
  };
}

/** Mutable paired mocks for tests that change identity within a suite. */
export function createMutableAuthMock(
  initial: AuthFixtureOptions = { role: 'admin' },
) {
  const getUser = vi.fn();
  const getClaims = vi.fn();

  function setIdentity(next: AuthFixtureOptions) {
    const { userResponse, claimsResponse } = buildAuthResponses(next);
    getUser.mockResolvedValue(userResponse);
    getClaims.mockResolvedValue(claimsResponse);
  }

  setIdentity(initial);
  return { auth: { getUser, getClaims }, getUser, getClaims, setIdentity };
}

/** Token-driven auth client for smoke tests with per-request bearer tokens. */
export function createTokenAuthClient(
  token?: string | null,
  overrides: Omit<AuthFixtureOptions, 'role' | 'userMetadataRole'> = {},
) {
  const role = resolveTokenRole(token);
  const defaultId =
    role === 'user'
      ? 'fixture-user-id'
      : role === 'admin'
        ? 'fixture-admin-id'
        : undefined;
  const { userResponse, claimsResponse } = buildAuthResponses({
    ...overrides,
    role,
    userId: overrides.userId ?? defaultId,
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue(userResponse),
      getClaims: vi.fn().mockResolvedValue(claimsResponse),
    },
  };
}
