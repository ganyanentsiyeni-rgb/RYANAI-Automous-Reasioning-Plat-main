#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = process.cwd();
const ignored = new Set([
  'scripts/validate-github-installation-token-compat.mjs',
  'scripts/github-installation-token-compat.test.mjs',
]);

// Installation tokens are opaque credentials. Detect legacy format assumptions,
// fixed 40-character checks, and undersized database token columns.
const legacyPatterns = [
  /ghs_\[A-Za-z0-9\]\{36\}/i,
  /ghs_\[A-Za-z0-9_\]\{36\}/i,
];
const narrowTokenColumn = /(?:access|installation|github)[_ ]?token[^\n;]*(?:varchar|character varying|char)\s*\(\s*(?:[1-4]?\d{1,2}|255)\s*\)/i;
const fixedLengthCheck = /(?:token|installation)[^\n]{0,100}(?:length\s*(?:===?|!==?)\s*40|\b40\s*characters)/i;

export function findCompatibilityRisks(content) {
  const risks = [];
  if (legacyPatterns.some((pattern) => pattern.test(content))) {
    risks.push('legacy ghs_ token regex assumes a 40-character token');
  }
  if (fixedLengthCheck.test(content)) {
    risks.push('possible fixed 40-character token length assumption');
  }
  if (narrowTokenColumn.test(content)) {
    risks.push('token storage column appears limited to 255 characters or fewer');
  }
  return risks;
}

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const failures = [];
for (const path of trackedFiles) {
  if (ignored.has(path) || !/\.(?:[cm]?[jt]sx?|ya?ml|json|sql|prisma|toml|env|sh|ps1)$/i.test(path)) continue;
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  for (const risk of findCompatibilityRisks(content)) failures.push(path + ': ' + risk);
}

if (failures.length) {
  console.error(failures.map((failure) => 'FAIL ' + failure).join('\n'));
  process.exitCode = 1;
} else {
  console.log('PASS GitHub installation-token compatibility audit: no legacy format or narrow-storage assumptions found');
}
