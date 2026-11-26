// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentControlPanel } from './AgentControlPanel';
import { TauriBridge } from '../services/tauriBridge';

vi.mock('../services/tauriBridge', () => ({
  TauriBridge: { executeObjective: vi.fn() },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const executeObjective = vi.mocked(TauriBridge.executeObjective);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('AgentControlPanel', () => {
  it('renders the durable AgentRun ID and persisted handoffs returned by reasoning', async () => {
    executeObjective.mockResolvedValue({
      status: 'completed',
      objective: 'inspect the service',
      result: 'Reasoning completed.',
      runId: 'run-evidence-123',
      handoffs: [
        { fromAgent: 'primary', toAgent: 'secondary', status: 'completed' },
        { fromAgent: 'secondary', toAgent: 'primary', status: 'completed' },
      ],
    });

    await act(async () => root.render(<AgentControlPanel />));

    const input = container.querySelector('input[aria-label="Reasoning objective"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, 'inspect the service');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Run request'));
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => expect(container.textContent).toContain('run-evidence-123'));
    expect(container.textContent).toContain('Persisted handoffs');
    expect(container.textContent).toContain('primary → secondary');
    expect(container.textContent).toContain('Reasoning completed.');
    expect(executeObjective).toHaveBeenCalledWith('inspect the service');
  });

  it('surfaces bridge failures without fabricating execution evidence', async () => {
    executeObjective.mockRejectedValue(new Error('Sign in to continue.'));

    await act(async () => root.render(<AgentControlPanel />));

    const input = container.querySelector('input[aria-label="Reasoning objective"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, 'inspect the service');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Run request'));
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => expect(container.textContent).toContain('Sign in to continue.'));
    expect(container.textContent).not.toContain('AgentRun');
  });
});
