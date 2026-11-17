import test from 'node:test';
import assert from 'node:assert/strict';
import { validateToolchain } from './runtime-preflight.mjs';

test('accepts the supported Node.js 24 and npm 10 toolchain', () => {
  assert.deepEqual(validateToolchain('v24.11.0', '10.9.2'), []);
});

test('rejects unsupported Node.js majors', () => {
  assert.match(validateToolchain('v22.12.0', '10.9.2').join(' '), /Node.js 24\.x is required/);
});

test('rejects npm versions older than 10', () => {
  assert.match(validateToolchain('v24.11.0', '9.9.0').join(' '), /npm 10 or newer is required/);
});

test('reports both toolchain mismatches together', () => {
  const errors = validateToolchain('v20.0.0', '8.0.0');
  assert.equal(errors.length, 2);
});
