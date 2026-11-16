// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AuthPage from './AuthPage';

const mock = vi.hoisted(() => ({
  configured: true,
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signInWithOAuth: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mock.configured ? { auth: mock } : null;
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  mock.configured = true;
  mock.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function fill(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
async function continueWithOAuth(provider: 'google' | 'github') {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(`button[data-provider="${provider}"]`)!.click();
  });
}
it.each(['signin', 'signup'] as const)(
  'starts Google OAuth from the %s screen and returns to the sign-in route',
  async (mode) => {
    await act(async () => root.render(<AuthPage mode={mode} />));
    await continueWithOAuth('google');
    expect(mock.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: 'openid email profile',
      },
    });
  },
);
it('starts GitHub OAuth with the expected profile scopes', async () => {
  await act(async () => root.render(<AuthPage />));
  await continueWithOAuth('github');
  expect(mock.signInWithOAuth).toHaveBeenCalledWith({
    provider: 'github',
    options: {
      redirectTo: window.location.origin,
      scopes: 'read:user user:email',
    },
  });
});
it.each([
  ['google', 'Google'],
  ['github', 'GitHub'],
] as const)(
  'explains when the %s OAuth provider is disabled in Supabase',
  async (provider, label) => {
    const providerError = Object.assign(
      new Error('Unsupported provider: provider is not enabled'),
      { code: 'validation_failed', status: 400 },
    );
    mock.signInWithOAuth.mockResolvedValue({
      data: { url: null },
      error: providerError,
    });
    await act(async () => root.render(<AuthPage />));
    await continueWithOAuth(provider);
    expect(container.querySelector('[role=alert]')?.textContent).toContain(
      `${label} sign-in is not enabled for this Supabase project`,
    );
    expect(container.querySelector('[role=alert]')?.textContent).toContain(
      'https://narsvpwymvlrhurqbthu.supabase.co/auth/v1/callback',
    );
  },
);
it('authenticates with normalized email and password', async () => {
  mock.signInWithPassword.mockResolvedValue({
    data: { session: {} },
    error: null,
  });
  await act(async () => root.render(<AuthPage />));
  await fill('[type=email]', 'Alice@Example.com');
  await fill('[type=password]', 'correct-password');
  await submit();
  expect(mock.signInWithPassword).toHaveBeenCalledWith({
    email: 'alice@example.com',
    password: 'correct-password',
  });
});
it('shows server rejection and keeps real OAuth choices available', async () => {
  mock.signInWithPassword.mockResolvedValue({
    data: {},
    error: new Error('Invalid login credentials'),
  });
  await act(async () => root.render(<AuthPage />));
  await fill('[type=email]', 'alice@example.com');
  await fill('[type=password]', 'wrong-password');
  await submit();
  expect(container.querySelector('[role=alert]')?.textContent).toContain(
    'Invalid login credentials',
  );
  expect(container.textContent).not.toContain('Try Demo');
  expect(container.querySelector('button[data-provider="google"]')).not.toBeNull();
  expect(container.querySelector('button[data-provider="github"]')).not.toBeNull();
});
it('keeps confirmation-required signups on the public screen', async () => {
  mock.signUp.mockResolvedValue({ data: { session: null }, error: null });
  await act(async () => root.render(<AuthPage mode="signup" />));
  await fill('[type=email]', 'alice@example.com');
  await fill('[autocomplete=name]', 'Alice');
  await fill('[type=password]', 'correct-password');
  await fill('label:last-of-type input', 'correct-password');
  await submit();
  expect(mock.signUp).toHaveBeenCalledWith({
    email: 'alice@example.com',
    password: 'correct-password',
    options: { data: { full_name: 'Alice' } },
  });
  expect(container.querySelector('[role=status]')?.textContent).toContain(
    'Check your email',
  );
  expect(
    container.querySelector<HTMLInputElement>('[type=password]')!.value,
  ).toBe('');
});
it('rejects mismatched passwords without calling the provider', async () => {
  await act(async () => root.render(<AuthPage mode="signup" />));
  await fill('[type=email]', 'alice@example.com');
  await fill('[type=password]', 'correct-password');
  await fill('label:last-of-type input', 'different-password');
  await submit();
  expect(mock.signUp).not.toHaveBeenCalled();
  expect(container.querySelector('[role=alert]')?.textContent).toContain(
    'Passwords do not match',
  );
});
it('disables authentication when configuration is absent', async () => {
  mock.configured = false;
  await act(async () => root.render(<AuthPage />));
  expect(container.querySelector('[role=alert]')?.textContent).toContain(
    'has not been configured',
  );
  expect(container.querySelector('form')).toBeNull();
});
