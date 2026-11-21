import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AccountControlCentre, { ACCOUNT_CONTROL_LINKS } from './AccountControlCentre';

describe('RyanAI account control centre', () => {
  it('renders an accessible account trigger with the verified role label', () => {
    const markup = renderToStaticMarkup(
      <AccountControlCentre
        displayName="RyanAI Owner"
        email="owner@example.test"
        roleLabel="Owner account"
        isOwner
        isAdmin={false}
        signingOut={false}
        onSignOut={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-haspopup="true"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('Open account and preferences menu');
    expect(markup).toContain('Owner account');
  });

  it('keeps the menu destinations connected to existing RyanAI routes and settings sections', () => {
    expect(ACCOUNT_CONTROL_LINKS.map(link => link.href)).toEqual([
      '#/settings',
      '#/settings?section=copilot-behavior-settings-title',
      '#/settings?section=account-security-title',
      '#/settings?section=github-settings-title',
      '#/survey',
      '#/help',
    ]);
    expect(ACCOUNT_CONTROL_LINKS.map(link => link.label)).toContain('Connected integrations');
    expect(ACCOUNT_CONTROL_LINKS.map(link => link.label)).toContain('Security & sessions');
  });
});
