// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import CommunityHelpPage from './CommunityHelp';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
describe('Community Help Centre', () => {
 it('presents public FAQ topics and a path to community feedback', async () => {
  await act(async () => root.render(<CommunityHelpPage />));
  expect(container.textContent).toContain('Community & Help Centre');
  expect(container.textContent).toContain('What is Gen-X?');
  expect(container.textContent).toContain('Can I use Quant Lab for live trading?');
  expect(container.textContent).toContain('Current capability status guide');
  expect(container.textContent).toContain('Privacy Policy');
  expect(container.querySelector('a[href="/terms/"]')).not.toBeNull();
  expect(container.querySelector('a[href="/about/"]')).not.toBeNull();
  expect(container.querySelector('a[href="/author/"]')).not.toBeNull();
  expect(container.querySelector('a[href="#/survey"]')).not.toBeNull();
 });
 it('filters answers while preserving relevant category context', async () => {
  await act(async () => root.render(<CommunityHelpPage />));
  const search = container.querySelector<HTMLInputElement>('#faq-search')!;
  await act(async () => {
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'Gen-X');
   search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.textContent).toContain('What is Gen-X?');
  expect(container.textContent).not.toContain('Can I use Quant Lab for live trading?');
 });
});
