import { MetricmindError } from './errors.js';
import { createSeedSemanticCatalog, getActiveMetricVersion, validateSemanticCatalog } from './semantic-catalog.js';
import { assertRangeWithinLimit, precedingEqualPeriod, resolvePeriod } from './time.js';

export function buildQueryPlan(interpretation, workspace, now = new Date(), semanticCatalog = createSeedSemanticCatalog(workspace)) {
  validateSemanticCatalog(semanticCatalog);
  const metric = semanticCatalog.metrics.find((item) => item.id === interpretation.metricId);
  if (!metric) throw new MetricmindError('UNKNOWN_METRIC', 'The selected metric no longer exists.');
  const metricVersion = getActiveMetricVersion(semanticCatalog, metric.id);
  if (interpretation.metricVersionId && interpretation.metricVersionId !== metricVersion.id) {
    throw new MetricmindError('METRIC_VERSION_CHANGED', 'The active metric version changed while planning the question.');
  }

  const current = resolvePeriod(interpretation.period, interpretation.timezone, now);
  assertRangeWithinLimit(current, workspace.dataSource.maximumRangeDays);
  const comparison = interpretation.comparison ? precedingEqualPeriod(current) : null;
  const dimension = interpretation.dimension
    ? semanticCatalog.dimensions.find((item) => item.id === interpretation.dimension && item.status === 'verified')
    : null;

  if (interpretation.dimension && !dimension) {
    throw new MetricmindError('UNKNOWN_DIMENSION', 'The requested dimension is not verified.');
  }
  if (dimension && !(metricVersion.definition.allowedDimensionIds ?? []).includes(dimension.id)) {
    throw new MetricmindError('DIMENSION_NOT_ALLOWED_FOR_METRIC', `Dimension ${dimension.name} is not approved for this metric.`);
  }

  const exclusionSets = (metricVersion.definition.exclusionSetIds ?? []).map((id) => {
    const exclusionSet = semanticCatalog.exclusionSets.find((item) => item.id === id && item.status === 'verified');
    if (!exclusionSet) throw new MetricmindError('UNKNOWN_EXCLUSION_SET', `Exclusion set ${id} is unavailable.`);
    return exclusionSet;
  });

  const metricDependencies = resolveDependencies(metricVersion, semanticCatalog);
  return {
    intent: interpretation.intent,
    metric: { ...metric, status: 'verified' },
    metricVersion,
    metricDependencies,
    exclusionSets,
    current,
    comparison,
    dimension,
    timezone: interpretation.timezone,
    ambiguities: interpretation.ambiguities,
    originalQuestion: interpretation.originalQuestion
  };
}

function resolveDependencies(metricVersion, catalog) {
  const aggregation = metricVersion.definition.aggregation;
  if (aggregation.type !== 'ratio') return {};
  const result = {};
  for (const [role, metricId] of [
    ['numerator', aggregation.numeratorMetricId],
    ['denominator', aggregation.denominatorMetricId]
  ]) {
    const metric = catalog.metrics.find((item) => item.id === metricId);
    if (!metric) throw new MetricmindError('INVALID_RATIO_DEPENDENCY', `Unknown ${role} metric ${metricId}.`);
    const version = getActiveMetricVersion(catalog, metricId);
    if (version.definition.entityId !== metricVersion.definition.entityId) {
      throw new MetricmindError('INCOMPATIBLE_RATIO_ENTITIES', 'Ratio components must count the same semantic entity.');
    }
    const exclusionSets = (version.definition.exclusionSetIds ?? []).map((id) => {
      const exclusionSet = catalog.exclusionSets.find((item) => item.id === id && item.status === 'verified');
      if (!exclusionSet) throw new MetricmindError('UNKNOWN_EXCLUSION_SET', `Exclusion set ${id} is unavailable.`);
      return exclusionSet;
    });
    result[role] = { metric, version, definition: version.definition, exclusionSets };
  }
  return result;
}
