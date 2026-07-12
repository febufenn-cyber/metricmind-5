import { MetricmindError } from './errors.js';

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const defaultWorkspace = Object.freeze({
  organization: {
    id: 'demo-org',
    name: 'Metricmind Demo',
    timezone: 'Asia/Kolkata'
  },
  dataSource: {
    id: 'demo-postgres',
    dialect: 'postgres',
    schema: 'analytics',
    table: 'product_events',
    freshnessThresholdMinutes: 360,
    statementTimeoutMs: 15_000,
    maximumRangeDays: 366,
    maximumRows: 1_000,
    columns: {
      eventName: 'event_name',
      userId: 'user_id',
      occurredAt: 'occurred_at',
      insertedAt: 'inserted_at'
    },
    dimensions: {
      platform: { column: 'platform', aliases: ['device', 'os'] },
      source: { column: 'source', aliases: ['channel', 'acquisition channel'] },
      country: { column: 'country', aliases: ['region', 'market'] },
      app_version: { column: 'app_version', aliases: ['version', 'release'] }
    },
    restrictedColumns: ['email', 'phone', 'password_hash', 'access_token']
  },
  metrics: [
    {
      id: 'signup',
      name: 'Signup',
      aliases: ['signups', 'signed up users', 'new users'],
      description: 'Distinct users who completed signup.',
      eventName: 'signup_completed',
      aggregation: 'distinct_users',
      status: 'verified'
    },
    {
      id: 'activation',
      name: 'Activated user',
      aliases: ['activation', 'activations', 'activated users'],
      description: 'Distinct users who created their first workspace.',
      eventName: 'workspace_created',
      aggregation: 'distinct_users',
      status: 'verified'
    },
    {
      id: 'purchase',
      name: 'Purchase',
      aliases: ['purchases', 'subscriptions', 'paid users'],
      description: 'Distinct users who started a paid subscription.',
      eventName: 'subscription_started',
      aggregation: 'distinct_users',
      status: 'verified'
    }
  ]
});

export function validateWorkspace(workspace) {
  if (!workspace?.organization?.timezone) {
    throw new MetricmindError('INVALID_WORKSPACE', 'An organization timezone is required.');
  }
  const source = workspace.dataSource;
  if (!source || source.dialect !== 'postgres') {
    throw new MetricmindError('INVALID_DATA_SOURCE', 'Phase 1 supports Postgres only.');
  }
  for (const value of [
    source.schema,
    source.table,
    source.columns.eventName,
    source.columns.userId,
    source.columns.occurredAt
  ]) {
    assertIdentifier(value);
  }
  if (source.columns.insertedAt) assertIdentifier(source.columns.insertedAt);
  for (const dimension of Object.values(source.dimensions ?? {})) {
    assertIdentifier(dimension.column);
  }
  for (const [name, value] of [
    ['statementTimeoutMs', source.statementTimeoutMs],
    ['maximumRows', source.maximumRows],
    ['freshnessThresholdMinutes', source.freshnessThresholdMinutes]
  ]) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new MetricmindError('INVALID_DATA_SOURCE_LIMIT', `${name} must be a positive integer.`);
    }
  }
  if (!Array.isArray(workspace.metrics) || workspace.metrics.length === 0) {
    throw new MetricmindError('NO_METRICS', 'At least one verified metric is required.');
  }
  for (const metric of workspace.metrics) {
    if (metric.status !== 'verified') {
      throw new MetricmindError('UNVERIFIED_METRIC', `Metric ${metric.id} is not verified.`);
    }
    if (!metric.eventName || metric.aggregation !== 'distinct_users') {
      throw new MetricmindError('UNSUPPORTED_METRIC', `Metric ${metric.id} uses an unsupported definition.`);
    }
  }
  return workspace;
}

export function quoteIdentifier(value) {
  assertIdentifier(value);
  return `"${value}"`;
}

function assertIdentifier(value) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new MetricmindError('INVALID_IDENTIFIER', `Unsafe SQL identifier: ${String(value)}`);
  }
}
