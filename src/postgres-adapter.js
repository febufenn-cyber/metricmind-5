import { MetricmindError } from './errors.js';

const MIN_TIMEOUT_MS = 50;
const MAX_TIMEOUT_MS = 30_000;
const MAX_RESULT_ROWS = 10_000;

export class PostgresQueryAdapter {
  constructor({ connectionString, clientFactory = defaultClientFactory, applicationName = 'metricmind-phase1b' } = {}) {
    this.connectionString = connectionString;
    this.clientFactory = clientFactory;
    this.applicationName = applicationName;
  }

  async query(sql, params = [], options = {}) {
    if (!this.connectionString) {
      throw new MetricmindError(
        'WAREHOUSE_NOT_CONFIGURED',
        'No Hyperdrive Postgres connection is configured.',
        undefined,
        503
      );
    }
    if (options.readOnly !== true) {
      throw new MetricmindError('WAREHOUSE_READ_ONLY_REQUIRED', 'Warehouse queries must explicitly request read-only execution.');
    }
    if (typeof sql !== 'string' || sql.trim().length === 0) {
      throw new MetricmindError('INVALID_SQL', 'Warehouse SQL must be a non-empty string.');
    }
    if (!Array.isArray(params)) {
      throw new MetricmindError('INVALID_QUERY_PARAMETERS', 'Warehouse query parameters must be an array.');
    }

    const statementTimeoutMs = boundedInteger(
      options.statementTimeoutMs,
      15_000,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
      'statementTimeoutMs'
    );
    const maximumRows = boundedInteger(options.maximumRows, 1_000, 1, MAX_RESULT_ROWS, 'maximumRows');
    let client;
    let transactionOpen = false;
    try {
      client = await this.clientFactory({
        connectionString: this.connectionString,
        applicationName: this.applicationName,
        connectionTimeoutMs: Math.min(statementTimeoutMs, 5_000),
        queryTimeoutMs: statementTimeoutMs
      });
      if (!client || typeof client.connect !== 'function' || typeof client.query !== 'function' || typeof client.end !== 'function') {
        throw new MetricmindError('INVALID_POSTGRES_CLIENT', 'The Postgres client factory returned an invalid client.', undefined, 500);
      }
      await client.connect();
      await client.query('BEGIN TRANSACTION READ ONLY');
      transactionOpen = true;
      await client.query(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);
      await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${Math.max(statementTimeoutMs * 2, 1_000)}ms'`);

      const result = await client.query({ text: sql, values: params });
      const rows = result?.rows;
      if (!Array.isArray(rows)) {
        throw new MetricmindError('INVALID_WAREHOUSE_RESPONSE', 'Postgres returned an invalid result shape.', undefined, 502);
      }
      if (rows.length > maximumRows) {
        throw new MetricmindError('RESULT_TOO_LARGE', 'The query returned more rows than permitted.', { maximumRows }, 413);
      }

      await client.query('ROLLBACK');
      transactionOpen = false;
      return { rows };
    } catch (error) {
      if (transactionOpen) await rollbackQuietly(client);
      if (error instanceof MetricmindError) throw error;
      throw classifyPostgresError(error);
    } finally {
      if (client) await closeQuietly(client);
    }
  }
}

export function createHyperdriveAdapter(binding, options = {}) {
  if (!binding?.connectionString) {
    return new PostgresQueryAdapter({ connectionString: null, ...options });
  }
  return new PostgresQueryAdapter({ connectionString: binding.connectionString, ...options });
}

async function defaultClientFactory({ connectionString, applicationName, connectionTimeoutMs, queryTimeoutMs }) {
  const { Client } = await import('pg');
  return new Client({
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: connectionTimeoutMs,
    query_timeout: queryTimeoutMs,
    keepAlive: true
  });
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  const resolved = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new MetricmindError('INVALID_EXECUTION_LIMIT', `${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function classifyPostgresError(error) {
  const code = String(error?.code ?? '');
  const details = code ? { postgresCode: code } : undefined;
  if (code === '28P01' || code === '28000') {
    return new MetricmindError('WAREHOUSE_AUTH_FAILED', 'Postgres rejected the warehouse credentials.', details, 502);
  }
  if (code === '42501') {
    return new MetricmindError('WAREHOUSE_PERMISSION_DENIED', 'The warehouse role lacks a required permission.', details, 403);
  }
  if (code === '25006') {
    return new MetricmindError('WAREHOUSE_READ_ONLY_VIOLATION', 'Postgres blocked a write inside the read-only transaction.', details, 403);
  }
  if (code === '57014') {
    return new MetricmindError('WAREHOUSE_TIMEOUT', 'The warehouse query exceeded its execution deadline.', details, 504);
  }
  if (code === '42P01' || code === '42703' || code === '3F000') {
    return new MetricmindError('WAREHOUSE_SCHEMA_MISMATCH', 'The configured warehouse schema no longer matches the query.', details, 422);
  }
  if (code.startsWith('08') || ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(code)) {
    return new MetricmindError('WAREHOUSE_UNREACHABLE', 'The Postgres warehouse could not be reached.', details, 502);
  }
  return new MetricmindError('WAREHOUSE_QUERY_FAILED', 'The read-only Postgres query failed.', details, 502);
}

async function rollbackQuietly(client) {
  try { await client.query('ROLLBACK'); } catch { /* preserve the primary error */ }
}

async function closeQuietly(client) {
  try { await client.end(); } catch { /* a closed socket needs no further action */ }
}
