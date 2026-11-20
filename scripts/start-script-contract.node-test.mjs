import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const serverConfig = JSON.parse(await readFile(new URL('../tsconfig.server.json', import.meta.url), 'utf8'));

test('npm start builds the server entrypoint before executing it', () => {
  assert.equal(packageJson.scripts.prestart, 'npm run build:server');
  assert.equal(packageJson.scripts.start, 'node dist/server/server/launcher.js');

  const outputDirectory = serverConfig.compilerOptions.outDir.replace(/^\.\//, '').replace(/\/$/, '');
  const sourceRoot = serverConfig.compilerOptions.rootDir.replace(/^\.\//, '').replace(/\/$/, '');
  const sourceEntry = 'src/server/launcher.ts';
  const relativeEntry = sourceEntry.slice(sourceRoot.length + 1).replace(/\.ts$/, '.js');

  assert.equal(`${outputDirectory}/${relativeEntry}`, 'dist/server/server/launcher.js');
});
