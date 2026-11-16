import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RyanAIAnniversaryCard from './RyanAIAnniversaryCard';

describe('RyanAI annual anniversary card', () => {
  it('shows the canonical identity, annual date and next celebration', () => {
    const html = renderToStaticMarkup(
      <RyanAIAnniversaryCard now={new Date('2026-11-08T12:00:00+02:00')} />,
    );
    expect(html).toContain('Mukhethwa Ryan Ganyane');
    expect(html).toContain('Every 24 May');
    expect(html).toContain('24 May 2024');
    expect(html).toContain('24 May 2027');
    expect(html).toContain('Years completed');
    expect(html).toContain('>2<');
  });

  it('increments the completed anniversary year on 24 May', () => {
    const html = renderToStaticMarkup(
      <RyanAIAnniversaryCard now={new Date('2027-05-24T12:00:00+02:00')} />,
    );
    expect(html).toContain('24 May 2028');
    expect(html).toContain('>3<');
  });
});
