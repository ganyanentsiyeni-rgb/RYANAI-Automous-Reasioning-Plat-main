import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAgentMock } = vi.hoisted(() => ({
  createAgentMock: vi.fn(),
}));

vi.mock('@ui-sdk/react/agent', () => ({
  createAgent: createAgentMock,
}));

import { createRyanAiAgentUiBridge } from './agentUiBridge';

describe('createRyanAiAgentUiBridge', () => {
  beforeEach(() => {
    createAgentMock.mockReset();
    createAgentMock.mockReturnValue({ snapshot: vi.fn(), query: vi.fn(), act: vi.fn() });
  });

  it('creates one bridge and allows steps that do not require human confirmation', async () => {
    createRyanAiAgentUiBridge({ requestApproval: vi.fn() });
    const options = createAgentMock.mock.calls[0][0];

    await expect(options.allow({ confirm: undefined }, { signal: new AbortController().signal })).resolves.toBe(true);
  });

  it('delegates confirmation to the application approval handler', async () => {
    const requestApproval = vi.fn().mockResolvedValue(true);
    createRyanAiAgentUiBridge({ requestApproval });
    const options = createAgentMock.mock.calls[0][0];
    const signal = new AbortController().signal;

    await expect(options.allow({ confirm: 'Archive this workspace' }, { signal })).resolves.toBe(true);
    expect(requestApproval).toHaveBeenCalledWith({
      summary: 'Archive this workspace',
      signal,
    });
  });

  it('refuses confirmed actions when approval is declined', async () => {
    const requestApproval = vi.fn().mockResolvedValue(false);
    createRyanAiAgentUiBridge({ requestApproval });
    const options = createAgentMock.mock.calls[0][0];

    await expect(options.allow({ confirm: 'Delete this record' }, { signal: new AbortController().signal })).resolves.toBe(false);
  });

  it('fails closed when approval throws or the step is already aborted', async () => {
    const requestApproval = vi.fn().mockRejectedValue(new Error('approval UI unavailable'));
    createRyanAiAgentUiBridge({ requestApproval });
    const options = createAgentMock.mock.calls[0][0];

    await expect(options.allow({ confirm: 'Send a message' }, { signal: new AbortController().signal })).resolves.toBe(false);

    const controller = new AbortController();
    controller.abort();
    await expect(options.allow({ confirm: 'Send a message' }, { signal: controller.signal })).resolves.toBe(false);
    expect(requestApproval).toHaveBeenCalledTimes(1);
  });
});
