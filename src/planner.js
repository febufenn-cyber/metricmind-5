import { MetricmindError } from './errors.js';
import { assertRangeWithinLimit, precedingEqualPeriod, resolvePeriod } from './time.js';

export function buildQueryPlan(interpretation, workspace, now = new Date()) {
  const metric = workspace.metrics.find((item) => item.id === interpretation.metricId);
  if (!metric) throw new MetricmindError('UNKNOWN_METRIC', 'The selected metric no longer exists.');

  const current = resolvePeriod(interpretation.period, interpretation.timezone, now);
  assertRangeWithinLimit(current, workspace.dataSource.maximumRangeDays);
  const comparison = interpretation.comparison ? precedingEqualPeriod(current) : null;
  const dimension = interpretation.dimension
    ? workspace.dataSource.dimensions[interpretation.dimension]
    : null;

  if (interpretation.dimension && !dimension) {
    throw new MetricmindError('UNKNOWN_DIMENSION', 'The requested dimension is not allowlisted.');
  }

  return {
    intent: interpretation.intent,
    metric,
    current,
    comparison,
    dimension: interpretation.dimension ? { id: interpretation.dimension, ...dimension } : null,
    timezone: interpretation.timezone,
    ambiguities: interpretation.ambiguities,
    originalQuestion: interpretation.originalQuestion
  };
}
