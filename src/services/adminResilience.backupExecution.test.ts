import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: spawnMock };
});

import { createDatabaseBackup } from './adminResilience.js';

const originalEnv = { ...process.env };
const dumpBytes = Buffer.from('RyanAI isolated backup execution fixture');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function configureBackupEnvironment() {
  process.env.DATABASE_URL = 'postgresql://backup-test:password@db.example.test:5432/ryanai';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  process.env.SUPABASE_BACKUP_BUCKET = 'private-backups';
  process.env.RYANAI_BACKUP_STORAGE_BUCKETS = 'uploads,documents';
}

function configurePgDumpMock() {
  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = new EventEmitter();
    if (args.includes('--version')) {
      queueMicrotask(() => child.emit('close', 0));
    } else {
      const fileIndex = args.indexOf('--file');
      const outputPath = args[fileIndex + 1];
      void writeFile(outputPath, dumpBytes).then(
        () => child.emit('close', 0),
        (error: Error) => child.emit('error', error),
      );
    }
    return child;
  });
}

beforeEach(() => {
  process.env = { ...originalEnv };
  configureBackupEnvironment();
  configurePgDumpMock();
});

afterEach(() => {
  vi.restoreAllMocks();
  spawnMock.mockReset();
  process.env = { ...originalEnv };
});

describe('admin resilience backup execution failure handling', () => {
  it('rejects a truncated Storage read-back after upload and does not write a manifest', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/storage/v1/bucket/')) return jsonResponse({ public: false });
      if (url.includes('/storage/v1/object/authenticated/')) {
        return new Response(dumpBytes.subarray(0, 12));
      }
      if (init?.method === 'POST') return jsonResponse({ Key: 'uploaded' });
      throw new Error('Unexpected Storage request: ' + url);
    });

    const result = await createDatabaseBackup();

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('read-back size or SHA-256 integrity verification');
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/manifest.json'))).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/object/authenticated/'))).toBe(true);
  });

  it('reports manifest persistence failure after a verified artifact upload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/storage/v1/bucket/')) return jsonResponse({ public: false });
      if (url.includes('/storage/v1/object/authenticated/')) return new Response(dumpBytes);
      if (url.endsWith('/manifest.json')) return jsonResponse({ error: 'manifest store unavailable' }, 503);
      if (init?.method === 'POST') return jsonResponse({ Key: 'uploaded' });
      throw new Error('Unexpected Storage request: ' + url);
    });

    const result = await createDatabaseBackup();

    expect(result.status).toBe('failed');
    expect(result.backupId).toBeTruthy();
    expect(result.prefix).toContain('ryanai-admin/');
    expect(result.reason).toContain('HTTP 503');
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/object/authenticated/'))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/manifest.json'))).toBe(true);
  });
});
