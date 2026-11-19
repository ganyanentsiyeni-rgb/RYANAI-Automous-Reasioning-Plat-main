import { describe, expect, it } from 'vitest';
import { buildAgentRunExecutionPrompt, parseAgentRunExecutionChange, parsePAExecutionScope, planQueuedAgentRun } from './agentRunExecution.js';

describe('durable agent-run execution planning', () => {
  it('defaults missing, malformed and unknown persisted scope to full reconciliation', () => {
    expect(planQueuedAgentRun(undefined).kind).toBe('full');
    expect(planQueuedAgentRun(null).kind).toBe('full');
    expect(planQueuedAgentRun('not-json-object').kind).toBe('full');
    expect(planQueuedAgentRun({ resourceKeys: ['one'] }).kind).toBe('full');
    expect(planQueuedAgentRun({ eventKnown: true, snapshotFresh: true, resourceKeys: { api: true } }).kind).toBe('full');
    expect(planQueuedAgentRun({ eventKnown: true, snapshotFresh: false, resourceKeys: ['one'] }).kind).toBe('full');
  });

  it('selects a targeted plan only when known and fresh are explicitly persisted', () => {
    const plan = planQueuedAgentRun({
      eventKnown: true,
      snapshotFresh: true,
      resourceKeys: ['api', 'web', 'api'],
    });
    expect(plan).toMatchObject({ kind: 'targeted', resourceKeys: ['api', 'web'] });
  });

  it('includes shared metadata only for fully valid resource keys and escalates malformed scope', () => {
    expect(planQueuedAgentRun({
      eventKnown: true,
      snapshotFresh: true,
      resourceKeys: ['*.example.test'],
      requiresSharedMetadata: true,
    })).toMatchObject({ kind: 'targeted-with-metadata', resourceKeys: ['*.example.test'] });
    expect(planQueuedAgentRun({
      eventKnown: true,
      snapshotFresh: true,
      resourceKeys: ['*.example.test', 12],
      requiresSharedMetadata: true,
    }).kind).toBe('full');
  });

  it('does not let stale or unknown state authorize a purge', () => {
    expect(planQueuedAgentRun({ eventKnown: false, snapshotFresh: true, purge: true }).kind).toBe('full');
    expect(planQueuedAgentRun({ eventKnown: true, snapshotFresh: false, purge: true }).kind).toBe('full');
    expect(planQueuedAgentRun({ eventKnown: true, snapshotFresh: true, purge: true }).kind).toBe('purge');
  });

  it('embeds the resolved scope and approval boundary in the worker prompt', () => {
    const plan = planQueuedAgentRun({ eventKnown: true, snapshotFresh: true, resourceKeys: ['api'] });
    const prompt = buildAgentRunExecutionPrompt('Fix the API', plan);
    expect(prompt).toContain('EXECUTION PLAN: targeted');
    expect(prompt).toContain('verified resources: api');
    expect(prompt).toContain('not authorization');
    expect(prompt).toContain('Fix the API');
  });

  it('treats non-true event/freshness flags as unverified', () => {
    const parsed = parseAgentRunExecutionChange({ eventKnown: 'true', snapshotFresh: 1, resourceKeys: ['x'] });
    expect(parsed.eventKnown).toBe(false);
    expect(parsed.snapshotFresh).toBe(false);
    expect(planQueuedAgentRun(parsed).kind).toBe('full');
  });
});


describe('PA execution scope validation', () => {
  it('accepts only a complete allowlisted delegation scope', () => {
    expect(parsePAExecutionScope({ paDelegationId: '123e4567-e89b-42d3-a456-426614174000', capabilities: ['tests.run'] })).toEqual({ delegationId: '123e4567-e89b-42d3-a456-426614174000', capabilities: ['tests.run'] });
    expect(parsePAExecutionScope({ unrelated: true })).toBeNull();
  });
  it('fails closed on partial, duplicate, malformed, or widened scopes', () => {
    for (const value of [{ paDelegationId: '123e4567-e89b-42d3-a456-426614174000' }, { capabilities: ['tests.run'] }, { paDelegationId: 'bad', capabilities: ['tests.run'] }, { paDelegationId: '123e4567-e89b-42d3-a456-426614174000', capabilities: ['tests.run', 'tests.run'] }, { paDelegationId: '123e4567-e89b-42d3-a456-426614174000', capabilities: ['credential.export'] }]) expect(() => parsePAExecutionScope(value)).toThrow();
  });
});
