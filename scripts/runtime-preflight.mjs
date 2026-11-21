#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function validateToolchain(nodeVersion, npmVersion) {
  const nodeMajor = Number(String(nodeVersion).replace(/^v/, '').split('.')[0]);
  const npmMajor = Number(String(npmVersion).split('.')[0]);
  const errors = [];
  if (nodeMajor !== 24) errors.push(`Node.js 24.x is required (found ${nodeVersion || 'unknown'}).`);
  if (!Number.isInteger(npmMajor) || npmMajor < 10) errors.push(`npm 10 or newer is required (found ${npmVersion || 'unknown'}).`);
  return errors;
}

function isPackageInstalled(startDir, name) {
  let dir = startDir;
  for (;;) {
    if (existsSync(resolve(dir, 'node_modules', name, 'package.json'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function commandVersion(command, args) {
  const executable = process.platform === 'win32' && command.endsWith('.cmd') ? 'cmd.exe' : command;
  const commandArgs = executable === 'cmd.exe' ? ['/d', '/s', '/c', `${command} ${args.join(' ')}`] : args;
  const result = spawnSync(executable, commandArgs, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return '';
  const output = (result.stdout || result.stderr).trim();
  return output.match(/(?:v|Python\s+)?(\d+\.\d+(?:\.\d+)?)/i)?.[1] ?? output;
}

export function inspectRuntime(projectRoot = root) {
  const errors = [];
  const warnings = [];
  const rootPackagePath = resolve(projectRoot, 'package.json');
  if (!existsSync(rootPackagePath)) return { errors: ['Root package.json is missing.'], warnings, checks: [] };

  const pkg = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
  const npmVersion = commandVersion(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version']);
  errors.push(...validateToolchain(process.versions.node, npmVersion));

  const requiredFiles = [
    'package-lock.json',
    'mcp-server/package.json',
    'mcp-server/package-lock.json',
    'workflows-ryanai/package.json',
    'workflows-ryanai/package-lock.json',
    'Dockerfile.api',
    'scripts/startup-verify.mjs',
    'src/server/launcher.ts'
  ];
  for (const file of requiredFiles) {
    if (!existsSync(resolve(projectRoot, file))) errors.push(`Required runtime/bootstrap file is missing: ${file}`);
  }

  for (const script of ['dev', 'dev:api', 'dev:web', 'dev:mcp', 'install:all', 'setup:dev', 'runtime:check', 'startup:verify']) {
    if (!pkg.scripts?.[script]) errors.push(`Required npm script is missing: ${script}`);
  }

  const checks = [];
  const moduleGroups = [
    {
      label: 'root',
      packageFile: 'package.json',
      modules: ['fastify', '@prisma/client', 'prisma', '@langchain/langgraph', 'pg', 'ioredis', 'vite', 'tsx', 'concurrently', 'typescript', 'vitest', 'cross-env']
    },
    {
      label: 'mcp-server',
      packageFile: 'mcp-server/package.json',
      modules: ['@modelcontextprotocol/sdk']
    },
    {
      label: 'workflows-ryanai',
      packageFile: 'workflows-ryanai/package.json',
      modules: ['@renderinc/sdk', 'openai', 'tsx', 'typescript']
    }
  ];

  for (const group of moduleGroups) {
    const packageDir = dirname(resolve(projectRoot, group.packageFile));
    const requireFromProject = createRequire(resolve(packageDir, 'package.json'));
    for (const name of group.modules) {
      try {
        requireFromProject.resolve(name);
        checks.push(`PASS ${group.label}: ${name}`);
      } catch (error) {
        // ESM-only or subpath-only packages (for example prisma, cross-env and
        // @modelcontextprotocol/sdk) have no CommonJS entry point, so
        // require.resolve() throws even when they are installed correctly.
        if (error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || error?.code === 'MODULE_NOT_FOUND') {
          if (isPackageInstalled(packageDir, name)) {
            checks.push(`PASS ${group.label}: ${name}`);
            continue;
          }
        }
        errors.push(`Dependency not installed or not resolvable: ${group.label}/${name}. Run npm run install:all.`);
      }
    }
  }

  if (process.env.RYANAI_CHECK_PYTHON === '1') {
    const python = commandVersion(process.platform === 'win32' ? 'python' : 'python3', ['--version']);
    const pythonMajorMinor = python.split('.').slice(0, 2).map(Number);
    if (pythonMajorMinor[0] !== 3 || pythonMajorMinor[1] < 12) {
      errors.push(`Python 3.12 or newer is required for the optional Python tooling (found ${python || 'unknown'}).`);
    } else {
      checks.push(`PASS optional Python toolchain: ${python}`);
    }
  } else {
    warnings.push('Optional Python packages are not required by the Node.js platform. Set RYANAI_CHECK_PYTHON=1 to check Python 3.12+.');
  }

  return { errors, warnings, checks };
}

function main() {
  const report = inspectRuntime();
  for (const check of report.checks) console.log(check);
  for (const warning of report.warnings) console.log(`INFO ${warning}`);
  for (const error of report.errors) console.error(`FAIL ${error}`);
  if (report.errors.length) {
    console.error(`Runtime preflight failed with ${report.errors.length} issue(s).`);
    process.exitCode = 1;
    return;
  }
  console.log('RyanAI runtime preflight passed. No services were started and no external systems were changed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
