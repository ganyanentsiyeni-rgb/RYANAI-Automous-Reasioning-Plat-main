import { inflateRawSync } from 'node:zlib';

export interface RyanAIGitHubJobLogExcerpt {
  jobName: string;
  excerpt: string;
  lineCount: number;
}

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 20;
const MAX_ENTRY_BYTES = 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 5 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function safeEntryName(name: string): boolean {
  return name.length > 0 && !name.startsWith('/') && !name.includes('\\') &&
    !name.split('/').some((part) => part === '..' || part === '.') &&
    name.toLowerCase().endsWith('.txt');
}

/** Extract only bounded text log entries from a GitHub Actions ZIP archive. */
export function extractRyanAIGitHubJobLogExcerpts(archive: Uint8Array): RyanAIGitHubJobLogExcerpt[] {
  const bytes = Buffer.from(archive);
  if (bytes.length < 22 || bytes.length > MAX_ARCHIVE_BYTES) {
    throw new Error('github_job_log_archive_size_invalid');
  }

  const searchStart = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('github_job_log_archive_invalid');
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8);
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries ||
      totalEntries > MAX_ENTRIES || centralOffset + centralSize > eocd) {
    throw new Error('github_job_log_archive_limits_exceeded');
  }

  const excerpts: RyanAIGitHubJobLogExcerpt[] = [];
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('github_job_log_archive_invalid');
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const nameEnd = cursor + 46 + nameLength;
    const next = nameEnd + extraLength + commentLength;
    if (next > bytes.length) throw new Error('github_job_log_archive_invalid');
    const name = bytes.toString('utf8', cursor + 46, nameEnd);
    cursor = next;

    if (!safeEntryName(name)) continue;
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8) ||
        uncompressedSize > MAX_ENTRY_BYTES || compressedSize > MAX_ARCHIVE_BYTES ||
        (compressedSize === 0 ? uncompressedSize > 0 : uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO)) {
      throw new Error('github_job_log_archive_limits_exceeded');
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('github_job_log_archive_limits_exceeded');
    }
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error('github_job_log_archive_invalid');
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error('github_job_log_archive_invalid');
    const compressed = bytes.subarray(dataStart, dataEnd);
    let decoded: Buffer;
    try {
      decoded = method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch {
      throw new Error('github_job_log_archive_invalid');
    }
    if (decoded.length !== uncompressedSize) throw new Error('github_job_log_archive_invalid');
    const text = decoded.toString('utf8').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
    const lines = text.split(/\r?\n/);
    const selected = lines
      .filter((line) => /error TS\d{4}|cannot find module|module not found|failed to resolve import|\b(test|tests|suite) failed\b|\bFAIL\b|npm ERR!|permission denied|EACCES|ECONNRESET|ETIMEDOUT|ENOTFOUND|rate.?limit/i.test(line))
      .slice(0, 40)
      .map((line) => line
        .replace(/(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '[REDACTED_TOKEN]')
        .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/ig, '$1[REDACTED]')
        .replace(/([?&](?:token|sig|se|sp|sv)=)[^&\s]+/ig, '$1[REDACTED]')
        .slice(0, 500));
    if (selected.length) {
      excerpts.push({
        jobName: name.split('/').pop()!.replace(/\.txt$/i, '').slice(0, 120),
        excerpt: selected.join('\n').slice(0, 8000),
        lineCount: lines.length,
      });
    }
  }
  return excerpts;
}
