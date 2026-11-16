import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentActivityIndicator from './AgentActivityIndicator';

describe('AgentActivityIndicator', () => {
  it.each([
    ['queued', 'Queued'],
    ['running', 'Running'],
    ['completed', 'Completed'],
    ['failed', 'Failed'],
    ['blocked', 'Blocked'],
    ['unknown', 'Unknown'],
  ] as const)('renders %s as %s', (state, label) => {
    const html = renderToStaticMarkup(<AgentActivityIndicator state={state} />);
    expect(html).toContain(`Execution status: ${label}`);
    expect(html).toContain(`data-activity-state="${state}"`);
    expect(html).toContain(`>${label}</span>`);
  });

  it('does not animate queued work as active execution', () => {
    const html = renderToStaticMarkup(<AgentActivityIndicator state="queued" />);
    expect(html).not.toContain('is-running');
  });

  it('animates only an explicitly reported running state', () => {
    const html = renderToStaticMarkup(<AgentActivityIndicator state="running" />);
    expect(html).toContain('is-running');
  });
});
