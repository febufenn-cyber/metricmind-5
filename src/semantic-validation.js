import { MetricmindError } from './errors.js';
import { compileQuery } from './compiler.js';
import { buildQueryPlan } from './planner.js';
import { assertSafeSql } from './sql-policy.js';
import { validateSemanticCatalog } from './semantic-catalog.js';
import { verifyResult } from './verifier.js';

export async function previewMetricVersion({
  catalog,
  metricVersionId,
  workspace,
  executor,
  now = new Date(),
  period = 'last_7_complete_days',
  expectedValue
}) {
  validateSemanticCatalog(catalog);
  const target = catalog.versions.find((version) => version.id === metricVersionId);
  if (!target) throw new MetricmindError('METRIC_VERSION_NOT_FOUND', `Metric version ${metricVersionId} does not exist.`, undefined, 404);
  if (target.status === 'deprecated') {
    throw new MetricmindError('DEPRECATED_METRIC_VERSION', 'Deprecated metric versions cannot be validated.', undefined, 409);
  }

  const previewCatalog = structuredClone(catalog);
  for (const version of previewCatalog.versions) {
    if (version.metricId !== target.metricId) continue;
    if (version.id === target.id) version.status = 'active';
    else if (version.status === 'active') version.status = 'superseded';
  }
  validateSemanticCatalog(previewCatalog);

  const interpretation = {
    intent: 'metric_total',
    metricId: target.metricId,
    metricVersionId: target.id,
    period,
    comparison: false,
    dimension: null,
    timezone: target.definition.timePolicy?.timezone ?? workspace.organization.timezone,
    ambiguities: [],
    originalQuestion: `Preview ${target.metricId} ${period}`
  };
  const plan = buildQueryPlan(interpretation, workspace, now, previewCatalog);
  const compiled = compileQuery(plan, workspace);
  assertSafeSql(compiled, workspace);
  const execution = await executor.query({
    ...compiled,
    plan,
    statementTimeoutMs: workspace.dataSource.statementTimeoutMs,
    maximumRows: workspace.dataSource.maximumRows
  });
  const verified = verifyResult(plan, compiled, execution);
  if (verified.kind !== 'single_value') {
    throw new MetricmindError('INVALID_PREVIEW_RESULT', 'Metric preview must return one aggregate value.');
  }

  const expected = expectedValue === undefined || expectedValue === null ? null : Number(expectedValue);
  if (expected !== null && !Number.isFinite(expected)) {
    throw new MetricmindError('INVALID_EXPECTED_VALUE', 'Expected metric value must be numeric.');
  }
  const expectedMatch = expected === null ? null : Math.abs(verified.value - expected) <= 1e-9;
  const status = expectedMatch === false ? 'failed' : 'passed';
  return {
    id: `validation-${metricVersionId}-${now.getTime()}`,
    metricVersionId,
    status,
    checks: [
      { key: 'catalog', status: 'passed' },
      { key: 'sql_safety', status: 'passed' },
      { key: 'warehouse_execution', status: 'passed' },
      { key: 'expected_value', status: expectedMatch === null ? 'not_provided' : expectedMatch ? 'passed' : 'failed' }
    ],
    previewResults: {
      value: verified.value,
      expectedValue: expected,
      expectedMatch,
      period,
      semanticLineage: compiled.semanticLineage
    },
    queryDurationMs: execution.durationMs,
    parameterCount: compiled.params.length,
    createdAt: now.toISOString()
  };
}

export function evaluateSemanticHealth(catalog, schemaDiscovery) {
  validateSemanticCatalog(catalog);
  const available = new Set((schemaDiscovery?.columns ?? []).map((column) => column.name));
  const restricted = new Set(schemaDiscovery?.mapping?.restrictedColumnsPresent ?? []);
  const results = new Map();

  for (const metric of catalog.metrics) {
    const version = catalog.versions.find((item) => item.metricId === metric.id && item.status === 'active');
    const definition = version.definition;
    const coreColumns = new Set([definition.timestampColumn]);
    if (definition.aggregation.type === 'distinct_count') coreColumns.add(definition.aggregation.column);
    for (const predicate of definition.predicates ?? []) coreColumns.add(predicate.column);
    for (const exclusionSetId of definition.exclusionSetIds ?? []) {
      const exclusionSet = catalog.exclusionSets.find((item) => item.id === exclusionSetId);
      for (const rule of exclusionSet?.rules ?? []) coreColumns.add(rule.column);
    }
    const optionalDimensions = (definition.allowedDimensionIds ?? [])
      .map((id) => catalog.dimensions.find((dimension) => dimension.id === id))
      .filter(Boolean);
    const missingCoreColumns = [...coreColumns].filter((column) => !available.has(column));
    const missingDimensionIds = optionalDimensions.filter((dimension) => !available.has(dimension.source.column)).map((dimension) => dimension.id);
    const restrictedColumnsUsed = [...coreColumns].filter((column) => restricted.has(column));
    const warnings = [];
    if (missingDimensionIds.length) warnings.push('One or more approved dimensions are unavailable.');
    if (restrictedColumnsUsed.length) warnings.push('Restricted columns are used as internal predicates or exclusions.');
    results.set(metric.id, {
      metricId: metric.id,
      metricName: metric.name,
      metricVersionId: version.id,
      status: missingCoreColumns.length ? 'invalid' : warnings.length ? 'warning' : 'healthy',
      missingCoreColumns,
      missingDimensionIds,
      restrictedColumnsUsed,
      warnings
    });
  }

  for (const metric of catalog.metrics) {
    const version = catalog.versions.find((item) => item.metricId === metric.id && item.status === 'active');
    if (version.definition.aggregation.type !== 'ratio') continue;
    const dependencies = [
      version.definition.aggregation.numeratorMetricId,
      version.definition.aggregation.denominatorMetricId
    ];
    const invalidDependencies = dependencies.filter((id) => results.get(id)?.status === 'invalid');
    if (invalidDependencies.length) {
      const current = results.get(metric.id);
      current.status = 'invalid';
      current.invalidDependencyMetricIds = invalidDependencies;
      current.warnings.push('A ratio component metric is invalid.');
    }
  }

  const metrics = [...results.values()];
  return {
    status: metrics.some((item) => item.status === 'invalid') ? 'invalid' : metrics.some((item) => item.status === 'warning') ? 'warning' : 'healthy',
    summary: {
      total: metrics.length,
      healthy: metrics.filter((item) => item.status === 'healthy').length,
      warning: metrics.filter((item) => item.status === 'warning').length,
      invalid: metrics.filter((item) => item.status === 'invalid').length
    },
    metrics
  };
}
