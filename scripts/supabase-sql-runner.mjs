#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;

const repoRoot = process.cwd();
const envPath = path.join(repoRoot, '.env.db.local');

function loadLocalEnv(filePath) {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function stripCommentsAndStrings(sql) {
  return sql
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'([^']|'')*'/g, "''")
    .replace(/"([^"]|"")*"/g, '""')
    .replace(/\$\w*\$[\s\S]*?\$\w*\$/g, '$$');
}

function isReadOnlySql(sql) {
  const normalized = stripCommentsAndStrings(sql).trim().replace(/;+\s*$/g, '');
  return /^(select|with|explain)\b/i.test(normalized);
}

function riskyTokens(sql) {
  const normalized = stripCommentsAndStrings(sql);
  const matches = normalized.match(/\b(insert|update|delete|drop|alter|create|replace)\b/gi);
  return [...new Set((matches || []).map((token) => token.toUpperCase()))];
}

function assertSafeToRun(sql) {
  const risky = riskyTokens(sql);
  const dbTarget = (process.env.DB_TARGET || '').toLowerCase();
  const isWriteAllowed =
    process.env.ALLOW_DB_WRITE === 'YES' &&
    ['beta', 'staging'].includes(dbTarget);

  if (dbTarget === 'production' && risky.length > 0) {
    throw new Error('Blocked: production writes are never allowed by this runner.');
  }

  if (risky.length > 0 && !isWriteAllowed) {
    throw new Error(`Blocked risky SQL token(s): ${risky.join(', ')}. Set ALLOW_DB_WRITE=YES and DB_TARGET=beta or staging only for approved beta/staging writes.`);
  }

  if (risky.length === 0 && !isReadOnlySql(sql)) {
    throw new Error('Blocked: SQL must start with SELECT, WITH, or EXPLAIN in read-only mode.');
  }
}

function wrapRowsAsJson(sql) {
  const trimmed = sql.trim().replace(/;+\s*$/g, '');
  if (/^explain\b/i.test(trimmed)) {
    return trimmed;
  }

  return `
WITH __codex_runner_rows AS (
${trimmed}
)
SELECT COALESCE(json_agg(row_to_json(__codex_runner_rows)), '[]'::json) AS rows
FROM __codex_runner_rows;
`;
}

function getSslConfig() {
  const dbTarget = (process.env.DB_TARGET || '').toLowerCase();
  const rejectUnauthorizedOverride = process.env.SUPABASE_DB_SSL_REJECT_UNAUTHORIZED;
  const allowStagingSelfSigned =
    ['beta', 'staging'].includes(dbTarget) &&
    rejectUnauthorizedOverride === 'NO';

  if (dbTarget === 'production' && rejectUnauthorizedOverride === 'NO') {
    throw new Error('Blocked: production connections must not disable SSL certificate verification.');
  }

  return { rejectUnauthorized: !allowStagingSelfSigned };
}

function getConnectionString(rawDbUrl) {
  const dbTarget = (process.env.DB_TARGET || '').toLowerCase();
  const rejectUnauthorizedOverride = process.env.SUPABASE_DB_SSL_REJECT_UNAUTHORIZED;
  const allowSelfSigned =
    ['beta', 'staging'].includes(dbTarget) &&
    rejectUnauthorizedOverride === 'NO';

  if (!allowSelfSigned) {
    return rawDbUrl;
  }

  const parsed = new URL(rawDbUrl);
  parsed.searchParams.delete('sslmode');
  parsed.searchParams.delete('sslrootcert');
  return parsed.toString();
}

loadLocalEnv(envPath);

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error('Usage: node scripts/supabase-sql-runner.mjs <path-to-sql-file>');
  process.exit(2);
}

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL. Put it in .env.db.local or export it in your local shell.');
  process.exit(2);
}

const sqlPath = path.resolve(repoRoot, sqlFile);
if (!existsSync(sqlPath)) {
  console.error(`SQL file not found: ${sqlFile}`);
  process.exit(2);
}

const sql = readFileSync(sqlPath, 'utf8');
const isWriteSql = riskyTokens(sql).length > 0;

try {
  assertSafeToRun(sql);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const query = isWriteSql ? sql : wrapRowsAsJson(sql);
let ssl;

try {
  ssl = getSslConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const client = new Client({
  connectionString: getConnectionString(dbUrl),
  ssl,
});

try {
  await client.connect();
  const result = await client.query(query);

  if (isWriteSql) {
    console.log(JSON.stringify({
      success: true,
      command: result.command || 'SQL',
      rowCount: result.rowCount ?? null,
    }, null, 2));
  } else if (/^explain\b/i.test(sql.trim())) {
    console.log(JSON.stringify(result.rows, null, 2));
  } else if (result.rows.length === 1 && Object.prototype.hasOwnProperty.call(result.rows[0], 'rows')) {
    console.log(JSON.stringify(result.rows[0].rows, null, 2));
  } else {
    console.log(JSON.stringify(result.rows, null, 2));
  }
} catch (error) {
  console.error(`Database query failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
