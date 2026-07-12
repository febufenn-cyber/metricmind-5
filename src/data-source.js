import { quoteIdentifier } from './config.js';
import { MetricmindError } from './errors.js';
import { evaluateFreshness } from './freshness.js';

export async function verifyDataSourceConnection({ executor, workspace }) {
  const qualifiedTable = `${workspace.dataSource.schema}.${workspace.dataSource.table}`;
  const qualifiedRegclass = `${quoteIdentifier(workspace.dataSource.schema)}.${quoteIdentifier(workspace.dataSource.table)}`;
  const execution = await executor.query({
    sql: `WITH target AS (SELECT to_regclass($1) AS oid)\nSELECT\n  current_user AS current_user,\n  current_database() AS database_name,\n  current_setting('transaction_read_only') AS transaction_read_only,\n  target.oid IS NOT NULL AS table_exists,\n  CASE WHEN target.oid IS NULL THEN FALSE ELSE has_table_privilege(current_user, target.oid, 'SELECT') END AS can_select,\n  CASE WHEN target.oid IS NULL THEN FALSE ELSE (\n    has_table_privilege(current_user, target.oid, 'INSERT') OR\n    has_table_privilege(current_user, target.oid, 'UPDATE') OR\n    has_table_privilege(current_user, target.oid, 'DELETE') OR\n    has_table_privilege(current_user, target.oid, 'TRUNCATE') OR\n    has_table_privilege(current_user, target.oid, 'REFERENCES') OR\n    has_table_privilege(current_user, target.oid, 'TRIGGER')\n  ) END AS can_write\nFROM target`,
    params: [qualifiedRegclass],
    statementTimeoutMs: 2_000,
    maximumRows: 1
  });
  if (execution.rows.length !== 1) {
    throw new MetricmindError('INVALID_CONNECTION_CHECK', 'Postgres returned an invalid connection check.', undefined, 502);
  }
  const row = execution.rows[0];
  if (!boolean(row.table_exists)) {
    throw new MetricmindError('DATA_SOURCE_TABLE_NOT_FOUND', 'The configured event table does not exist.', { qualifiedTable }, 422);
  }
  if (!boolean(row.can_select)) {
    throw new MetricmindError('DATA_SOURCE_SELECT_DENIED', 'The warehouse role cannot SELECT from the configured event table.', undefined, 403);
  }
  if (boolean(row.can_write)) {
    throw new MetricmindError('DATA_SOURCE_ROLE_CAN_WRITE', 'The warehouse role has write privileges. Use a dedicated SELECT-only role.', undefined, 409);
  }
  if (String(row.transaction_read_only).toLowerCase() !== 'on') {
    throw new MetricmindError('WAREHOUSE_READ_ONLY_NOT_ENFORCED', 'The adapter did not establish a read-only transaction.', undefined, 500);
  }
  return {
    status: 'connected',
    currentUser: String(row.current_user),
    databaseName: String(row.database_name),
    table: qualifiedTable,
    readOnlyTransaction: true,
    canSelect: true,
    canWrite: false,
    durationMs: execution.durationMs
  };
}

export async function discoverDataSource({ executor, workspace, eventLimit = 50, eventLookbackDays = 30, now = new Date() }) {
  const source = workspace.dataSource;
  const limit = boundedEventLimit(eventLimit);
  const lookbackDays = boundedLookbackDays(eventLookbackDays);
  const columnsExecution = await executor.query({
    sql: `SELECT column_name, data_type, is_nullable\nFROM information_schema.columns\nWHERE table_schema = $1 AND table_name = $2\nORDER BY ordinal_position`,
    params: [source.schema, source.table],
    statementTimeoutMs: 5_000,
    maximumRows: 500
  });
  const columns = columnsExecution.rows.map((row) => ({
    name: String(row.column_name),
    dataType: String(row.data_type),
    nullable: String(row.is_nullable).toUpperCase() === 'YES'
  }));
  if (columns.length === 0) {
    throw new MetricmindError('DATA_SOURCE_TABLE_NOT_FOUND', 'The configured event table could not be discovered.', undefined, 422);
  }

  const available = new Set(columns.map((column) => column.name));
  const required = [source.columns.eventName, source.columns.userId, source.columns.occurredAt];
  const missingRequiredColumns = required.filter((column) => !available.has(column));
  const restrictedColumnsPresent = (source.restrictedColumns ?? []).filter((column) => available.has(column));
  const mapping = {
    valid: missingRequiredColumns.length === 0,
    requiredColumns: required,
    missingRequiredColumns,
    restrictedColumnsPresent
  };

  if (!mapping.valid) {
    return {
      table: `${source.schema}.${source.table}`,
      columns,
      mapping,
      eventLookbackDays: lookbackDays,
      topEvents: [],
      durationMs: columnsExecution.durationMs
    };
  }

  const table = `${quoteIdentifier(source.schema)}.${quoteIdentifier(source.table)}`;
  const eventName = quoteIdentifier(source.columns.eventName);
  const lookbackStart = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString();
  const occurredAt = quoteIdentifier(source.columns.occurredAt);
  const eventsExecution = await executor.query({
    sql: `SELECT ${eventName}::text AS event_name, COUNT(*)::bigint AS event_count\nFROM ${table}\nWHERE ${occurredAt} >= $1::timestamptz\nGROUP BY 1\nORDER BY event_count DESC\nLIMIT $2`,
    params: [lookbackStart, limit],
    statementTimeoutMs: 5_000,
    maximumRows: limit
  });

  return {
    table: `${source.schema}.${source.table}`,
    columns,
    mapping,
    eventLookbackDays: lookbackDays,
    topEvents: eventsExecution.rows.map((row) => ({
      eventName: String(row.event_name),
      count: number(row.event_count)
    })),
    durationMs: columnsExecution.durationMs + eventsExecution.durationMs
  };
}

export async function getDataSourceFreshness({ executor, workspace, now = new Date() }) {
  const source = workspace.dataSource;
  const table = `${quoteIdentifier(source.schema)}.${quoteIdentifier(source.table)}`;
  const occurredAt = quoteIdentifier(source.columns.occurredAt);
  const insertedAt = source.columns.insertedAt ? quoteIdentifier(source.columns.insertedAt) : null;
  const freshnessExpression = insertedAt ? `MAX(${insertedAt})` : `MAX(${occurredAt})`;
  const execution = await executor.query({
    sql: `SELECT ${freshnessExpression} AS max_ingested_at, MAX(${occurredAt}) AS max_occurred_at, $1::timestamptz AS observed_at\nFROM ${table}`,
    params: [now.toISOString()],
    statementTimeoutMs: 5_000,
    maximumRows: 1
  });
  if (execution.rows.length !== 1) {
    throw new MetricmindError('INVALID_FRESHNESS_RESULT', 'Postgres returned an invalid freshness result.', undefined, 502);
  }
  const row = execution.rows[0];
  return {
    ...evaluateFreshness(row.max_ingested_at, now, source.freshnessThresholdMinutes),
    maxOccurredAt: isoOrNull(row.max_occurred_at),
    durationMs: execution.durationMs,
    sourceColumn: insertedAt ? source.columns.insertedAt : source.columns.occurredAt
  };
}

function boundedLookbackDays(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 90) {
    throw new MetricmindError('INVALID_LOOKBACK_DAYS', 'eventLookbackDays must be an integer between 1 and 90.');
  }
  return parsed;
}

function boundedEventLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new MetricmindError('INVALID_EVENT_LIMIT', 'eventLimit must be an integer between 1 and 100.');
  }
  return parsed;
}

function boolean(value) {
  return value === true || value === 't' || value === 'true';
}

function number(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new MetricmindError('INVALID_NUMERIC_RESULT', `Invalid warehouse numeric value: ${String(value)}`);
  }
  return parsed;
}

function isoOrNull(value) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
