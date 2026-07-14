import { MetricmindError } from './errors.js';

const FORBIDDEN = /\b(insert|update|delete|merge|upsert|alter|drop|truncate|create|grant|revoke|copy|call|do|execute|prepare|deallocate|vacuum|analyze|refresh|reindex|cluster|listen|notify|load|security|pg_sleep|dblink|lo_import|lo_export)\b/i;
const SYSTEM_SCHEMA = /\b(pg_catalog|information_schema|pg_toast|auth)\b/i;

export function assertSafeSql(compiled, workspace) {
  const sql = compiled?.sql;
  if (typeof sql !== 'string' || sql.length === 0 || sql.length > 30_000) {
    throw new MetricmindError('INVALID_SQL', 'Generated SQL is empty or exceeds the safety limit.');
  }
  const stripped = stripQuotedLiterals(sql);
  if (/--|\/\*/.test(stripped)) {
    throw new MetricmindError('SQL_COMMENTS_BLOCKED', 'SQL comments are not permitted.');
  }
  if ((stripped.match(/;/g) ?? []).length > 0) {
    throw new MetricmindError('MULTI_STATEMENT_BLOCKED', 'Only one SQL statement is permitted.');
  }
  if (!/^\s*(select|with)\b/i.test(stripped)) {
    throw new MetricmindError('NON_SELECT_BLOCKED', 'Only read-only SELECT queries are permitted.');
  }
  if (FORBIDDEN.test(stripped)) {
    throw new MetricmindError('FORBIDDEN_SQL', 'The query contains a forbidden SQL operation.');
  }
  if (SYSTEM_SCHEMA.test(stripped)) {
    throw new MetricmindError('FORBIDDEN_SCHEMA', 'System and authentication schemas are not queryable.');
  }

  const configuredTable = `"${workspace.dataSource.schema}"."${workspace.dataSource.table}"`;
  const allowedTables = new Set([configuredTable, ...(compiled.allowedTables ?? [])]);
  const allowedRelations = new Set(compiled.allowedRelations ?? []);
  const tableMatches = [...stripped.matchAll(/\b(from|join)\s+([^\s,)]+)/gi)].map((match) => match[2]);
  if (tableMatches.length === 0 || tableMatches.some((table) => !allowedTables.has(table) && !allowedRelations.has(table))) {
    throw new MetricmindError('TABLE_NOT_ALLOWLISTED', 'The query references a table or relation outside the data-source allowlist.', { tableMatches });
  }
  if (!Array.isArray(compiled.params) || compiled.params.length === 0) {
    throw new MetricmindError('UNPARAMETERIZED_QUERY', 'Queries must use bound parameters.');
  }
  return true;
}

function stripQuotedLiterals(sql) {
  let output = '';
  let single = false;
  let double = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (single) {
      if (char === "'" && next === "'") { index += 1; continue; }
      if (char === "'") single = false;
      output += ' ';
      continue;
    }
    if (double) {
      output += char;
      if (char === '"' && next === '"') { output += next; index += 1; continue; }
      if (char === '"') double = false;
      continue;
    }
    if (char === "'") { single = true; output += ' '; continue; }
    if (char === '"') { double = true; output += char; continue; }
    output += char;
  }
  return output;
}
