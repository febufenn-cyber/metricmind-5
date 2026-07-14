import { quoteIdentifier } from './config.js';
import { MetricmindError } from './errors.js';

export function compileRetention(definition, period, workspace) {
  if (!definition?.cohortEvent || !definition?.returnEvent) {
    throw new MetricmindError('INVALID_RETENTION_EVENTS', 'Retention requires cohort and return events.');
  }
  const grain = definition.grain ?? 'week';
  if (!['day', 'week', 'month'].includes(grain)) {
    throw new MetricmindError('INVALID_RETENTION_GRAIN', 'Retention grain must be day, week, or month.');
  }
  const periods = Number(definition.periods ?? 8);
  if (!Number.isInteger(periods) || periods < 1 || periods > 24) {
    throw new MetricmindError('INVALID_RETENTION_PERIODS', 'Retention periods must be 1 to 24.');
  }
  const table = `"${workspace.dataSource.schema}"."${workspace.dataSource.table}"`;
  const event = quoteIdentifier(workspace.dataSource.columns.eventName);
  const entity = quoteIdentifier(definition.entityColumn ?? workspace.dataSource.columns.userId);
  const occurred = quoteIdentifier(workspace.dataSource.columns.occurredAt);
  const params = [
    definition.cohortEvent,
    definition.returnEvent,
    definition.timezone ?? workspace.organization.timezone,
    period.start.toISOString(),
    period.end.toISOString(),
    periods
  ];
  const periodIndex = grain === 'month'
    ? `(DATE_PART('year', a.activity_start) - DATE_PART('year', c.cohort_start)) * 12 + DATE_PART('month', a.activity_start) - DATE_PART('month', c.cohort_start)`
    : `FLOOR(DATE_PART('epoch', a.activity_start - c.cohort_start) / ${grain === 'week' ? 604800 : 86400})`;
  const maturity = grain === 'month' ? 'make_interval(months => $6)' : grain === 'week' ? 'make_interval(weeks => $6)' : 'make_interval(days => $6)';
  const sql = `WITH cohorts AS (\n  SELECT ${entity} AS entity_id, DATE_TRUNC('${grain}', MIN(${occurred}) AT TIME ZONE $3) AS cohort_start\n  FROM ${table}\n  WHERE ${event} = $1 AND ${occurred} >= $4::timestamptz AND ${occurred} < $5::timestamptz\n  GROUP BY ${entity}\n), activity AS (\n  SELECT ${entity} AS entity_id, DATE_TRUNC('${grain}', ${occurred} AT TIME ZONE $3) AS activity_start\n  FROM ${table}\n  WHERE ${event} = $2 AND ${occurred} >= $4::timestamptz AND ${occurred} < $5::timestamptz\n  GROUP BY ${entity}, 2\n), cohort_sizes AS (\n  SELECT cohort_start, COUNT(*) AS cohort_users FROM cohorts GROUP BY cohort_start\n)\nSELECT c.cohort_start, ${periodIndex}::integer AS period_index, COUNT(DISTINCT c.entity_id) AS retained_users, s.cohort_users\nFROM cohorts c\nJOIN activity a ON a.entity_id = c.entity_id AND a.activity_start >= c.cohort_start\nJOIN cohort_sizes s ON s.cohort_start = c.cohort_start\nWHERE ${periodIndex} BETWEEN 0 AND $6 AND c.cohort_start < DATE_TRUNC('${grain}', $5::timestamptz AT TIME ZONE $3) - ${maturity}\nGROUP BY c.cohort_start, period_index, s.cohort_users\nORDER BY c.cohort_start, period_index\nLIMIT ${workspace.dataSource.maximumRows}`;
  return {
    sql,
    params,
    expectedShape: 'advanced_retention',
    allowedTables: [table],
    allowedRelations: ['cohorts', 'activity', 'cohort_sizes']
  };
}

export function verifyRetentionResult(execution) {
  if (!Array.isArray(execution?.rows)) throw new MetricmindError('INVALID_RETENTION_RESULT', 'Retention rows are missing.');
  return {
    kind: 'retention',
    cohorts: execution.rows.map((row) => {
      const retainedUsers = numeric(row.retained_users);
      const cohortUsers = numeric(row.cohort_users);
      return {
        cohortStart: new Date(row.cohort_start).toISOString(),
        periodIndex: numeric(row.period_index),
        retainedUsers,
        cohortUsers,
        retentionRate: cohortUsers === 0 ? null : retainedUsers / cohortUsers
      };
    })
  };
}

function numeric(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new MetricmindError('INVALID_RETENTION_NUMBER', 'Retention values must be non-negative.');
  return number;
}
