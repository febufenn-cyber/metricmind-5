import { quoteIdentifier } from './config.js';
import { MetricmindError } from './errors.js';

export function compileQuery(plan, workspace) {
  const source = workspace.dataSource;
  const table = `${quoteIdentifier(source.schema)}.${quoteIdentifier(source.table)}`;
  const event = quoteIdentifier(source.columns.eventName);
  const user = quoteIdentifier(source.columns.userId);
  const occurred = quoteIdentifier(source.columns.occurredAt);
  const metricExpression = `COUNT(DISTINCT ${user})`;

  const start = plan.current.start.toISOString();
  const end = plan.current.end.toISOString();

  switch (plan.intent) {
    case 'metric_total':
      return {
        sql: `SELECT ${metricExpression} AS value\nFROM ${table}\nWHERE ${event} = $1 AND ${occurred} >= $2::timestamptz AND ${occurred} < $3::timestamptz`,
        params: [plan.metric.eventName, start, end],
        expectedShape: 'single_value'
      };
    case 'time_series':
      return {
        sql: `SELECT DATE_TRUNC('day', ${occurred} AT TIME ZONE $4) AS bucket, ${metricExpression} AS value\nFROM ${table}\nWHERE ${event} = $1 AND ${occurred} >= $2::timestamptz AND ${occurred} < $3::timestamptz\nGROUP BY 1\nORDER BY 1 ASC\nLIMIT ${source.maximumRows}`,
        params: [plan.metric.eventName, start, end, plan.timezone],
        expectedShape: 'time_series'
      };
    case 'segmentation':
    case 'ranking': {
      if (!plan.dimension) throw new MetricmindError('DIMENSION_REQUIRED', 'A verified dimension is required.');
      const dimension = quoteIdentifier(plan.dimension.column);
      return {
        sql: `SELECT COALESCE(NULLIF(${dimension}::text, ''), 'Unknown') AS segment, ${metricExpression} AS value\nFROM ${table}\nWHERE ${event} = $1 AND ${occurred} >= $2::timestamptz AND ${occurred} < $3::timestamptz\nGROUP BY 1\nORDER BY value DESC\nLIMIT ${source.maximumRows}`,
        params: [plan.metric.eventName, start, end],
        expectedShape: 'segmentation'
      };
    }
    case 'period_comparison':
      return {
        sql: `SELECT\n  CASE\n    WHEN ${occurred} >= $2::timestamptz AND ${occurred} < $3::timestamptz THEN 'current'\n    WHEN ${occurred} >= $4::timestamptz AND ${occurred} < $5::timestamptz THEN 'previous'\n  END AS period,\n  ${metricExpression} AS value\nFROM ${table}\nWHERE ${event} = $1 AND ${occurred} >= $4::timestamptz AND ${occurred} < $3::timestamptz\nGROUP BY 1\nHAVING CASE\n    WHEN ${occurred} >= $2::timestamptz AND ${occurred} < $3::timestamptz THEN 'current'\n    WHEN ${occurred} >= $4::timestamptz AND ${occurred} < $5::timestamptz THEN 'previous'\n  END IS NOT NULL\nORDER BY period`,
        params: [
          plan.metric.eventName,
          start,
          end,
          plan.comparison.start.toISOString(),
          plan.comparison.end.toISOString()
        ],
        expectedShape: 'period_comparison'
      };
    default:
      throw new MetricmindError('UNSUPPORTED_INTENT', `Unsupported query intent: ${plan.intent}`);
  }
}
