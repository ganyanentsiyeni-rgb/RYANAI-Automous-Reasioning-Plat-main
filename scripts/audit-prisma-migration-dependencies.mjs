#!/usr/bin/env node
/**
 * Conservative, offline migration dependency audit.
 * Reads only prisma/schema.prisma and prisma/migrations/*/migration.sql.
 * It never imports a database client or opens a database connection.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATION_ID = /^\d{14}_[a-z0-9_]+$/i;

function splitStatements(sql) {
  // Tokenize PostgreSQL statements without treating comment markers or semicolons
  // inside quoted strings/identifiers and dollar-quoted bodies as syntax.
  const statements = [];
  const unsupported = [];
  let current = '';
  let quote = null;
  let dollarTag = null;
  let blockCommentDepth = 0;
  let lineComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
        current += char;
      }
      continue;
    }
    if (blockCommentDepth > 0) {
      if (char === '/' && next === '*') {
        blockCommentDepth += 1;
        i += 1;
      } else if (char === '*' && next === '/') {
        blockCommentDepth -= 1;
        i += 1;
      }
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += char;
      }
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote && next === quote) {
        current += next;
        i += 1;
      } else if (char === quote && sql[i - 1] !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockCommentDepth = 1;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '$') {
      const match = sql.slice(i).match(/^\$[a-zA-Z_0-9]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }
    if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (quote) unsupported.push('unterminated_quoted_string');
  if (dollarTag) unsupported.push('unterminated_dollar_quoted_block');
  if (blockCommentDepth > 0) unsupported.push('unterminated_block_comment');
  if (current.trim()) statements.push(current.trim());
  return { statements, unsupported };
}

function normalizeIdentifier(value) {
  return value.replace(/"/g, '').split('.').map(part => part.trim().toLowerCase()).join('.');
}

function tableNameFromMatch(value) {
  return normalizeIdentifier(value).replace(/^public\./, '');
}

function isSchemaQualified(value) {
  return normalizeIdentifier(value).includes('.');
}

function recordUnresolvedTable(migrationId, object, rawTable, findingStatus, externalDependencies, findings) {
  if (isSchemaQualified(rawTable)) {
    externalDependencies.push({
      migrationId,
      object,
      dependency: normalizeIdentifier(rawTable),
      status: 'external_dependency_not_verified',
    });
  } else {
    findings.push({ migrationId, object, status: findingStatus });
  }
}

export function analyzeMigrationDependencies(migrations) {
  const ordered = [...migrations].sort((a, b) => a.id.localeCompare(b.id));
  const seenIds = new Set();
  const createdTables = new Set();
  const findings = [];
  const externalDependencies = [];
  const unsupported = [];
  const duplicateMigrationIds = [];
  const invalidMigrationIds = [];
  const missingFiles = [];
  let statementCount = 0;

  for (const migration of ordered) {
    if (!MIGRATION_ID.test(migration.id)) invalidMigrationIds.push(migration.id);
    if (seenIds.has(migration.id)) duplicateMigrationIds.push(migration.id);
    seenIds.add(migration.id);
    if (typeof migration.sqlContent !== 'string' || migration.sqlContent.trim() === '') {
      missingFiles.push(migration.id);
      continue;
    }

    const parsed = splitStatements(migration.sqlContent);
    unsupported.push(...parsed.unsupported.map(kind => migration.id + ':' + kind));
    for (const statement of parsed.statements) {
      statementCount += 1;
      const sql = statement.replace(/\s+/g, ' ').trim();
      if (/^(CREATE|ALTER|DROP)\s+TYPE\b/i.test(sql) || /^DO\b/i.test(sql) ||
          /\bEXECUTE\s+|\bCREATE\s+FUNCTION\b|\bCREATE\s+TRIGGER\b|\bCREATE\s+VIEW\b/i.test(sql)) {
        unsupported.push(migration.id + ':unsupported_ddl');
        continue;
      }

      const create = sql.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)/i);
      if (create) {
        const table = tableNameFromMatch(create[1]);
        if (createdTables.has(table)) findings.push({ migrationId: migration.id, object: table, status: 'duplicate_create_table' });
        createdTables.add(table);
        const references = [...sql.matchAll(/REFERENCES\s+([\w".]+)\s*\(/gi)];
        for (const ref of references) {
          const target = tableNameFromMatch(ref[1]);
          if (!createdTables.has(target)) {
            if (target.includes('.')) externalDependencies.push({ migrationId: migration.id, object: table, dependency: target, status: 'external_dependency_not_verified' });
            else findings.push({ migrationId: migration.id, object: table, dependency: target, status: 'referenced_table_not_yet_created' });
          }
        }
        continue;
      }

      const alter = sql.match(/^ALTER\s+TABLE\s+(?:ONLY\s+)?([\w".]+)/i);
      if (alter) {
        const table = tableNameFromMatch(alter[1]);
        if (!createdTables.has(table)) recordUnresolvedTable(migration.id, table, alter[1], 'alter_before_create_or_external_dependency', externalDependencies, findings);
        const refs = [...sql.matchAll(/REFERENCES\s+([\w".]+)\s*\(/gi)];
        for (const ref of refs) {
          const target = tableNameFromMatch(ref[1]);
          if (!createdTables.has(target)) {
            if (target.includes('.')) externalDependencies.push({ migrationId: migration.id, object: table, dependency: target, status: 'external_dependency_not_verified' });
            else findings.push({ migrationId: migration.id, object: table, dependency: target, status: 'referenced_table_not_yet_created' });
          }
        }
        continue;
      }

      const index = sql.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\b[\s\S]*?\bON\s+([\w".]+)/i);
      if (index) {
        const table = tableNameFromMatch(index[1]);
        if (!createdTables.has(table)) recordUnresolvedTable(migration.id, table, index[1], 'index_before_create_or_external_dependency', externalDependencies, findings);
        continue;
      }

      if (/^(CREATE|ALTER|DROP|COMMENT)\s+/i.test(sql)) {
        unsupported.push(migration.id + ':unclassified_ddl');
      }
    }
  }

  const complete = ordered.length > 0 && duplicateMigrationIds.length === 0 &&
    invalidMigrationIds.length === 0 && missingFiles.length === 0 &&
    findings.length === 0 && externalDependencies.length === 0 && unsupported.length === 0;
  return {
    status: complete ? 'static_dependencies_clear' : 'static_dependencies_incomplete',
    scope: 'conservative_static_sql_dependency_scan',
    databaseQueried: false,
    sqlExecuted: false,
    migrationCount: ordered.length,
    statementCount,
    createdTableCount: createdTables.size,
    duplicateMigrationIds,
    invalidMigrationIds,
    missingFiles,
    findings,
    externalDependencies,
    unsupported: [...new Set(unsupported)],
    compatibility: 'not_verified',
    reason: complete
      ? 'No dependency-order issue was found in the supported CREATE TABLE, ALTER TABLE, and CREATE INDEX subset.'
      : 'Static dependency analysis is incomplete; unresolved findings or unsupported SQL prevent a compatibility claim.',
  };
}

async function main() {
  const root = process.cwd();
  const migrationsPath = path.join(root, 'prisma', 'migrations');
  const entries = await readdir(migrationsPath, { withFileTypes: true });
  const ids = entries.filter(entry => entry.isDirectory() && MIGRATION_ID.test(entry.name))
    .map(entry => entry.name).sort();
  const migrations = await Promise.all(ids.map(async id => {
    try {
      return { id, sqlContent: await readFile(path.join(migrationsPath, id, 'migration.sql'), 'utf8') };
    } catch {
      return { id, sqlContent: null };
    }
  }));
  const schemaPath = path.join(root, 'prisma', 'schema.prisma');
  let schemaPresent = false;
  try {
    schemaPresent = (await readFile(schemaPath, 'utf8')).trim().length > 0;
  } catch { /* report missing schema as incomplete */ }
  const report = analyzeMigrationDependencies(migrations);
  report.schemaSourcePresent = schemaPresent;
  if (!schemaPresent) {
    report.status = 'static_dependencies_incomplete';
    report.unsupported.push('missing_prisma_schema');
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.status !== 'static_dependencies_clear') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write('Offline migration dependency audit failed: ' + (error instanceof Error ? error.message : 'unknown error') + '\n');
    process.exitCode = 1;
  });
}
