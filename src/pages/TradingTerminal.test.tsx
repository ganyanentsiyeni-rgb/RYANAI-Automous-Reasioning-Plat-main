// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TradingTerminalPage from './TradingTerminal';

vi.mock('@/components/quant/PaperTradingPanel', () => ({ default: () => null }));
vi.mock('@/components/quant/PaperStrategyAllocations', () => ({ default: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

async function openTab(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Trading terminal sections"] button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Trading tab not found: ${label}`);
  await act(async () => button.click());
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Trading Terminal', () => {
  it('defaults to the overview and clearly labels the workspace as paper-only', async () => {
    await act(async () => root.render(<TradingTerminalPage />));

    expect(container.textContent).toContain('Trading Terminal');
    expect(container.textContent).toContain('Paper simulation only · no live broker');
    expect(container.textContent).toContain('Market watch');
    expect(container.textContent).toContain('Research linked');
    expect(container.textContent).toContain('Risk governed');
  });

  it('opens the forex research view without implying live market data', async () => {
    await act(async () => root.render(<TradingTerminalPage />));
    await openTab('Forex');

    expect(container.textContent).toContain('Market analysis workspace');
    expect(container.textContent).toContain('Research mode');
    expect(container.textContent).toContain('Awaiting data');
    expect(container.textContent).toContain('Live quotes are not displayed until a verified market-data provider is connected.');
  });

  it('keeps wallet funding and withdrawals disabled until a provider is connected', async () => {
    await act(async () => root.render(<TradingTerminalPage />));
    await openTab('Wallet');

    expect(container.textContent).toContain('Funding & withdrawals');
    expect(container.textContent).toContain('Provider connection required');
    expect(container.textContent).toContain('No bank credentials, payment instruction or real-money transfer');
    const withdraw = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Withdraw'));
    expect(withdraw).not.toBeNull();

    await act(async () => withdraw!.click());

    expect(container.textContent).toContain('Withdrawal destination');
    const transferButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Withdrawal unavailable'));
    expect(transferButton?.disabled).toBe(true);
  });

  it('shows server-enforced risk limits in the risk center', async () => {
    await act(async () => root.render(<TradingTerminalPage />));
    await openTab('Risk Center');

    expect(container.textContent).toContain('Risk Center');
    expect(container.textContent).toContain('Server enforced');
    expect(container.textContent).toContain('Emergency stop');
    expect(container.textContent).toContain('Explicit reset required');
  });
});
