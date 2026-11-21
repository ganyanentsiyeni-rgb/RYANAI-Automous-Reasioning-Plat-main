import { describe, expect, it } from 'vitest';
import { createDefaultPluginRegistry, DEFAULT_PLUGIN_MANIFESTS } from './pluginCatalog.js';

describe('default server plugin catalogue', () => {
  it('contains the core integrations shown in RyanAI Settings', () => {
    const registry = createDefaultPluginRegistry();
    const ids = registry.list().map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining([
      'github',
      'vscode-web',
      'vlc',
      'spotify',
      'youtube-music',
      'google-calendar',
      'microsoft-365-calendar',
      'gmail',
      'outlook-mail',
      'slack',
      'microsoft-teams',
      'whatsapp-business',
      'twilio',
      'notion',
      'dropbox',
      'sharepoint',
      'asana',
      'linear',
      'trello',
      'zapier',
      'firecrawl',
    ]));
  });

  it('preserves the PhoneLink mobile category in the canonical registry', () => {
    const phoneLink = DEFAULT_PLUGIN_MANIFESTS.find((manifest) => manifest.id === 'phonelink');
    expect(phoneLink?.categories).toContain('mobile');
    expect(createDefaultPluginRegistry().get('phonelink')?.categories).toContain('mobile');
  });

  it('marks every provider as adapter_required until a real adapter is registered', () => {
    expect(createDefaultPluginRegistry().list().every((entry) => entry.adapterStatus === 'adapter_required'))
      .toBe(true);
  });

  it('limits Gmail and Outlook catalogue capabilities to read-only metadata access', () => {
    const registry = createDefaultPluginRegistry();
    for (const providerId of ['gmail', 'outlook-mail']) {
      const manifest = registry.get(providerId);
      expect(manifest?.capabilities).toEqual([
        { id: 'messages.read', risk: 'read', requiresHumanApproval: false },
      ]);
      expect(manifest?.description).toContain('Drafting and sending are not enabled');
    }
  });

  it('requires human approval for every outbound or destructive capability', () => {
    for (const manifest of DEFAULT_PLUGIN_MANIFESTS) {
      for (const capability of manifest.capabilities) {
        if (capability.risk === 'outbound' || capability.risk === 'destructive') {
          expect(capability.requiresHumanApproval, `${manifest.id}:${capability.id}`).toBe(true);
        }
      }
    }
  });

  it('does not include credential, token or connection values in catalogue metadata', () => {
    const serialized = JSON.stringify(createDefaultPluginRegistry().list());
    expect(serialized).not.toMatch(/access.?token|refresh.?token|client.?secret|password|credential/i);
  });
});
