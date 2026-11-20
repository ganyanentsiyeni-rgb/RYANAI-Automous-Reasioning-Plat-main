import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractRyanAIGitHubJobLogExcerpts } from './ryanaiGitHubJobLogs.js';

function makeZip(name: string, content: string): Buffer {
  const filename = Buffer.from(name);
  const raw = Buffer.from(content);
  const compressed = deflateRawSync(raw);
  const local = Buffer.alloc(30 + filename.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(filename.length, 26);
  filename.copy(local, 30);
  const central = Buffer.alloc(46 + filename.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(filename.length, 28);
  filename.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}

describe('bounded GitHub Actions log archive extraction', () => {
  it('extracts only failure-signature lines and redacts credentials', () => {
    const archive = makeZip('42_build.txt', [
      'normal build output',
      'error TS2322: type mismatch',
      'Authorization: Bearer secret-value',
      'FAIL test suite',
    ].join('\n'));
    const [result] = extractRyanAIGitHubJobLogExcerpts(archive);
    expect(result.jobName).toBe('42_build');
    expect(result.excerpt).toContain('error TS2322');
    expect(result.excerpt).toContain('FAIL test suite');
    expect(result.excerpt).not.toContain('secret-value');
    expect(result.lineCount).toBe(4);
  });

  it('ignores unsafe and non-text archive entries', () => {
    const archive = makeZip('../escape.txt', 'FAIL suite');
    expect(extractRyanAIGitHubJobLogExcerpts(archive)).toEqual([]);
  });

  it('rejects malformed and oversized archives', () => {
    expect(() => extractRyanAIGitHubJobLogExcerpts(Buffer.from('not a zip'))).toThrow('github_job_log_archive');
    expect(() => extractRyanAIGitHubJobLogExcerpts(Buffer.alloc(2 * 1024 * 1024 + 1))).toThrow('github_job_log_archive_size_invalid');
  });
});
