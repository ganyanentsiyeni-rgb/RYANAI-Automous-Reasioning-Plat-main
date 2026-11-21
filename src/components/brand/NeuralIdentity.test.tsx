import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import NeuralIdentity from './NeuralIdentity';
import { NEURAL_IDENTITIES } from './neuralIdentityDefinitions';

describe('NeuralIdentity', () => {
  it('defines distinct identities for Ryan, Alex, Gen-X and specialists', () => {
    expect(Object.keys(NEURAL_IDENTITIES)).toEqual([
      'ryan',
      'alex',
      'genx',
      'specialist',
    ]);
    expect(NEURAL_IDENTITIES.genx.role).toBe('Governance authority');
    expect(NEURAL_IDENTITIES.alex.role).toBe('Collaboration partner');
  });

  it('renders the identity and role accessibly', () => {
    const html = renderToStaticMarkup(<NeuralIdentity identity="ryan" />);
    expect(html).toContain('aria-label="Ryan, Primary assistant"');
    expect(html).toContain('Primary assistant');
  });

  it('supports a compact label without hiding the accessible identity', () => {
    const html = renderToStaticMarkup(
      <NeuralIdentity identity="genx" compact />,
    );
    expect(html).toContain('aria-label="Gen-X, Governance authority"');
    expect(html).toContain('Gen-X');
    expect(html).not.toContain('ryan-neural-identity__role');
  });

  it('keeps specialist roles visually distinct', () => {
    const html = renderToStaticMarkup(
      <NeuralIdentity identity="specialist" />,
    );
    expect(html).toContain('ryan-neural-identity--amber');
    expect(html).toContain('Focused agent');
  });
});
