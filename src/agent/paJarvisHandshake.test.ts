import { describe, expect, it } from 'vitest';
import { signAgentIdentityProof, verifyPAIdentityProof, verifyJarvisIdentityProof, PA_IDENTITY, JARVIS_IDENTITY } from './paJarvisHandshake.js';

const key = 'a'.repeat(48);
const proof = {
  version: 1 as const,
  issuer: PA_IDENTITY,
  subject: PA_IDENTITY,
  audience: JARVIS_IDENTITY,
  ownerUserId: 'user-1',
  delegationId: 'delegation-1',
  nonce: 'nonce-1234567890123456',
  issuedAt: 1800000000,
  expiresAt: 1800000060,
  capabilities: ['repository.inspect'] as const,
};

const store = () => {
  const seen = new Set<string>();
  return { consume: async (nonce: string) => !seen.has(nonce) && (seen.add(nonce), true) };
};

describe('PA identity proof', () => {
  it('accepts a reciprocal Jarvis proof bound to the owner and delegation', async () => {
    const jarvisProof = { ...proof, issuer: JARVIS_IDENTITY, subject: JARVIS_IDENTITY, audience: PA_IDENTITY };
    const token = signAgentIdentityProof(jarvisProof, key);
    await expect(
      verifyJarvisIdentityProof(token, key, store(), 'user-1', 'delegation-1', proof.issuedAt + 1),
    ).resolves.toEqual(jarvisProof);
  });

  it('rejects a reciprocal Jarvis proof bound to another delegation', async () => {
    const jarvisProof = { ...proof, issuer: JARVIS_IDENTITY, subject: JARVIS_IDENTITY, audience: PA_IDENTITY };
    const token = signAgentIdentityProof(jarvisProof, key);
    await expect(
      verifyJarvisIdentityProof(token, key, store(), 'user-1', 'other-delegation', proof.issuedAt + 1),
    ).rejects.toMatchObject({ code: 'invalid_identity' });
  });
  it('accepts a valid proof', async () => {
    await expect(verifyPAIdentityProof(signAgentIdentityProof(proof, key), key, store(), proof.issuedAt + 1)).resolves.toEqual(proof);
  });

  it('rejects replay', async () => {
    const token = signAgentIdentityProof(proof, key);
    const nonces = store();
    await verifyPAIdentityProof(token, key, nonces, proof.issuedAt + 1);
    await expect(verifyPAIdentityProof(token, key, nonces, proof.issuedAt + 1)).rejects.toMatchObject({ code: 'replayed' });
  });

  it('rejects wrong identity and out-of-scope capability', async () => {
    const wrong = { ...proof, issuer: 'untrusted' };
    await expect(verifyPAIdentityProof(signAgentIdentityProof(wrong, key), key, store(), proof.issuedAt + 1)).rejects.toMatchObject({ code: 'invalid_identity' });
    const scoped = { ...proof, capabilities: ['production.change'] as unknown as typeof proof.capabilities };
    await expect(verifyPAIdentityProof(signAgentIdentityProof(scoped, key), key, store(), proof.issuedAt + 1)).rejects.toMatchObject({ code: 'invalid_scope' });
  });
});
