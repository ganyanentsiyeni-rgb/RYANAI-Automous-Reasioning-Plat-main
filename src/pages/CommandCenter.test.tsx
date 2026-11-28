// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommandCenter from './CommandCenter';

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const MotionDiv = React.forwardRef((props: Record<string, unknown>, ref: React.ForwardedRef<HTMLDivElement>) =>
    React.createElement('div', { ...props, ref }));
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: { div: MotionDiv },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: null }));
vi.mock('@/lib/useVoiceRecognition', () => ({
  VOICE_COMMANDS: {},
  useVoiceRecognition: () => ({
    state: 'idle',
    interimText: '',
    isSupported: false,
    toggle: vi.fn(),
    stop: vi.fn(),
  }),
}));
vi.mock('@/components/Sidebar', () => ({
  default: () => <div data-testid="sidebar">Conversation history</div>,
}));
vi.mock('@/components/ChatPanel', () => ({
  default: (props: { onOpenLeft: () => void; onOpenRight: () => void }) => (
    <div data-testid="chat-panel">
      <button type="button" onClick={props.onOpenLeft}>Open history</button>
      <button type="button" onClick={props.onOpenRight}>Open telemetry</button>
    </div>
  ),
}));
vi.mock('@/components/TelemetryPanel', () => ({
  default: () => <div data-testid="telemetry">Live telemetry</div>,
}));
vi.mock('@/components/AboutModel', () => ({ default: () => null }));
vi.mock('@/components/MemoryVault', () => ({ default: () => null }));
vi.mock('@/components/GithubModal', () => ({ default: () => null }));
vi.mock('@/components/CodeRain', () => ({ default: () => null }));
vi.mock('@/components/ChatInterface', () => ({ default: () => null }));
vi.mock('@/components/Modal', () => ({ default: () => null }));
vi.mock('./commandCenterOperations', () => ({
  persistOutgoingUserMessage: vi.fn(),
  streamAssistantResponse: vi.fn(),
  prepareConversationArchive: vi.fn(),
  persistImportedConversationMessages: vi.fn(),
  rollbackImportedConversation: vi.fn(),
}));
vi.mock('@/lib/attachments', () => ({
  removeConversationAttachments: vi.fn(),
  safeAttachmentName: (value: string) => value,
  signConversationAttachment: vi.fn(),
}));
vi.mock('@/lib/conversationArchive', () => ({ createTarArchive: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  createConversation: vi.fn(() => ({ id: 'local-1', title: 'New Thread', model: 'gpt-5.4', messages: [], createdAt: 1, updatedAt: 1 })),
  createMessage: vi.fn(),
  generateTitle: vi.fn(() => 'New Thread'),
  loadConversations: vi.fn(() => []),
  saveConversations: vi.fn(),
}));
vi.mock('@/lib/models', () => ({
  DEFAULT_MODEL: 'gpt-5.4',
  MODELS: { 'gpt-5.4': { label: 'GPT-5.4' } },
  modelMeta: () => ({ label: 'GPT-5.4' }),
}));
vi.mock('@/shared/languages', () => ({
  DEFAULT_LANGUAGE: 'en',
  isRyanLanguage: () => true,
}));
vi.mock('@/lib/dialogFocus', () => ({
  trapDialogTabKey: vi.fn(),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const baseProps = {
  onSignOut: vi.fn(),
  userId: 'user-a',
};

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

describe('CommandCenter mobile drawers', () => {
  it('opens the conversation drawer and restores focus to its trigger on close', async () => {
    await act(async () => root.render(<CommandCenter {...baseProps} />));

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Open conversation history"]');
    expect(trigger).not.toBeNull();
    trigger!.focus();

    await act(async () => trigger!.click());

    const drawer = container.querySelector<HTMLElement>('#command-center-conversation-drawer');
    expect(drawer).not.toBeNull();
    expect(drawer!.getAttribute('role')).toBe('dialog');
    expect(drawer!.getAttribute('aria-modal')).toBe('true');
    expect(drawer!.getAttribute('aria-label')).toBe('Conversation history');
    expect(container.querySelector('[aria-label="Close conversation history"]')).not.toBeNull();

    await act(async () => {
      const close = container.querySelector<HTMLButtonElement>('[aria-label="Close conversation history"]');
      close!.click();
    });

    await vi.waitFor(() => expect(container.querySelector('#command-center-conversation-drawer')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the active drawer on Escape and keeps only one mobile drawer open', async () => {
    await act(async () => root.render(<CommandCenter {...baseProps} />));

    const leftTrigger = container.querySelector<HTMLButtonElement>('[aria-label="Open conversation history"]')!;
    const rightTrigger = container.querySelector<HTMLButtonElement>('[aria-label="Open live telemetry"]')!;

    leftTrigger.focus();
    await act(async () => leftTrigger.click());
    expect(container.querySelector('#command-center-conversation-drawer')).not.toBeNull();

    await act(async () => rightTrigger.click());

    await vi.waitFor(() => expect(container.querySelector('#command-center-conversation-drawer')).toBeNull());
    expect(container.querySelector('#command-center-telemetry-drawer')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    await vi.waitFor(() => expect(container.querySelector('#command-center-telemetry-drawer')).toBeNull());
    expect(document.activeElement).toBe(rightTrigger);
  });
});
