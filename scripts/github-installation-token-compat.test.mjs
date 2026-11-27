import { describe, expect, it } from 'vitest';
import { findCompatibilityRisks } from './validate-github-installation-token-compat.mjs';

describe('GitHub installation token compatibility audit', () => {
  it('allows opaque token forwarding and text storage', () => {
    expect(findCompatibilityRisks([
      'const token = response.token;',
      'headers.Authorization = "Bearer " + token;',
      'encrypted_access_token TEXT NOT NULL',
    ].join('\n'))).toEqual([]);
  });

  it('detects legacy 40-character ghs token regexes', () => {
    const legacy = 'ghs_' + '[A-Za-z0-9]' + '{36}';
    expect(findCompatibilityRisks('const tokenPattern = /' + legacy + '/;'))
      .toContain('legacy ghs_ token regex assumes a 40-character token');
  });

  it('detects explicit fixed-length checks', () => {
    expect(findCompatibilityRisks('if (installationToken.length === 40) reject();'))
      .toContain('possible fixed 40-character token length assumption');
  });

  it('does not flag unrelated device-session token lengths', () => {\n    expect(findCompatibilityRisks('const token = /^Bearer ([A-Za-z0-9_-]{40,60})$/.exec(value)?.[1];')).toEqual([]);\n  });\n\n  it('detects narrow token columns', () => {
    expect(findCompatibilityRisks('access_token VARCHAR(255) NOT NULL'))
      .toContain('token storage column appears limited to 255 characters or fewer');
  });
});
