import { describe, expect, it } from 'vitest';
import { canonicalCursor, cursorKey, websocketUrl } from './useRealtimeEvents';

describe('useRealtimeEvents cursor protocol', () => {
  it('accepts canonical decimal strings beyond JavaScript safe integer range', () => {
    expect(canonicalCursor('900719925474099312345')).toBe('900719925474099312345');
  });

  it('accepts safe numeric cursors and rejects unsafe or malformed values', () => {
    expect(canonicalCursor(42)).toBe('42');
    expect(canonicalCursor(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(canonicalCursor(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(canonicalCursor('-1')).toBeNull();
    expect(canonicalCursor('01')).toBeNull();
    expect(canonicalCursor('1.5')).toBeNull();
    expect(canonicalCursor(null)).toBeNull();
  });

  it('keeps cursor storage names channel-scoped', () => {
    expect(cursorKey('tasks.updates')).toBe('ryanai:realtime-cursor:tasks.updates');
    expect(cursorKey('comms.inbox')).not.toBe(cursorKey('tasks.updates'));
  });
});


describe('useRealtimeEvents WebSocket URL resolution', () => {
  it('converts configured HTTPS API origins to secure WebSocket URLs', () => {
    expect(websocketUrl('https://api.example.test')).toBe('wss://api.example.test/ws');
  });

  it('converts configured HTTP API origins to WebSocket URLs', () => {
    expect(websocketUrl('http://localhost:3001')).toBe('ws://localhost:3001/ws');
  });

  it('rejects missing runtime origins instead of falling back to loopback', () => {
    expect(() => websocketUrl('')).toThrow('Realtime WebSocket base URL is not available');
  });
});
