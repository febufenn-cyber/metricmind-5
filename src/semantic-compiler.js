import { quoteIdentifier } from './config.js';
import { MetricmindError } from './errors.js';

export function compileSemanticQuery(plan, workspace) {
  const aggregation = plan.metricVersion.definition.aggregation;
  if (aggregation.type === 'ratio') return compileRatio(plan, workspace);
  return compileCountMetric(plan, workspace);
}

function compileCountMetric(plan, workspace) {
  const definition = plan.metricVersion.definition;
  assertSourceBoundary(definition, workspace);
  const table = qualifiedTable(definition.source);
  const occurredAt = quoteIdentifier(definition.timestampColumn);
  const expression = aggregateExpression(definition);
  const bag = new ParameterBag();
  const baseConditions = compileDefinitionConditions(definition, plan.exclusionSets, bag);
  const lineage = semanticLineage(plan);

  if (plan.intent === 'metric_total') {
    const conditions = [...baseConditions, ...compilePeriodConditions(occurredAt, plan.current, bag)];
    return compiled(
      `SELECT ${expression} AS value\nFROM ${table}\nWHERE ${conditions.join(' AND ')}`,
      bag,
      'single_value',
      'count',
      lineage
    );
  }

  if (plan.intent === 'time_series') {
    const timezone = bag.add(plan.timezone);
    const conditions = [...baseConditions, ...compilePeriodConditions(occurredAt, plan.current, bag)];
    return compiled(
      `SELECT DATE_TRUNC('day', ${occurredAt} AT TIME ZONE ${timezone}) AS bucket, ${expression} AS value\nFROM ${table}\nWHERE ${conditions.join(' AND ')}\nGROUP BY 1\nORDER BY 1 ASC\nLIMIT ${workspace.dataSource.maximumRows}`,
      bag,
      'time_series',
      'count',
      lineage
    );
  }

  if (plan.intent === 'segmentation' || plan.intent === 'ranking') {
    if (!plan.dimension) throw new MetricmindError('DIMENSION_REQUIRED', 'A verified dimension is required.');
    assertDimensionBoundary(plan.dimension, definition, workspace);
    const dimension = quoteIdentifier(plan.dimension.source.column);
    const conditions = [...baseConditions, ...compilePeriodConditions(occurredAt, plan.current, bag)];
    return compiled(
      `SELECT COALESCE(NULLIF(${dimension}::text, ''), 'Unknown') AS segment, ${expression} AS value\nFROM ${table}\nWHERE ${conditions.join(' AND ')}\nGROUP BY 1\nORDER BY value DESC\nLIMIT ${workspace.dataSource.maximumRows}`,
      bag,
      'segmentation',
      'count',
      lineage
    );
  }

  if (plan.intent === 'period_comparison') {
    const currentStart = bag.add(plan.current.start.toISOString());
    const currentEnd = bag.add(plan.current.end.toISOString());
    const previousStart = bag.add(plan.comparison.start.toISOString());
    const previousEnd = bag.add(plan.comparison.end.toISOString());
    const periodCase = `CASE\n    WHEN ${occurredAt} >= ${currentStart}::timestamptz AND ${occurredAt} < ${currentEnd}::timestamptz THEN 'current'\n    WHEN ${occurredAt} >= ${previousStart}::timestamptz AND ${occurredAt} < ${previousEnd}::timestamptz THEN 'previous'\n  END`;
    const conditions = [
      ...baseConditions,
      `${occurredAt} >= ${previousStart}::timestamptz`,
      `${occurredAt} < ${currentEnd}::timestamptz`
    ];
    return compiled(
      `SELECT\n  ${periodCase} AS period,\n  ${expression} AS value\nFROM ${table}\nWHERE ${conditions.join(' AND ')}\nGROUP BY 1\nHAVING ${periodCase} IS NOT NULL\nORDER BY period`,
      bag,
      'period_comparison',
      'count',
      lineage
    );
  }

  throw new MetricmindError('UNSUPPORTED_INTENT', `Unsupported query intent: ${plan.intent}`);
}

function compileRatio(plan, workspace) {
  if (!['metric_total', 'period_comparison'].includes(plan.intent)) {
    throw new MetricmindError(
      'UNSUPPORTED_RATIO_INTENT',
      'Ratio metrics currently support totals and complete-period comparisons only.'
    );
  }
  const numerator = plan.metricDependencies.numerator;
  const denominator = plan.metricDependencies.denominator;
  if (!numerator || !denominator) {
    throw new MetricmindError('INVALID_RATIO_DEPENDENCY', 'Ratio metric dependencies are incomplete.');
  }
  const bag = new ParameterBag();
  const lineage = semanticLineage(plan);
  const ratioFor = (period) => {
    const numeratorSql = scalarAggregate(numerator.definition, numerator.exclusionSets, period, workspace, bag);
    const denominatorSql = scalarAggregate(denominator.definition, denominator.exclusionSets, period, workspace, bag);
    return `(${numeratorSql} / NULLIF(${denominatorSql}, 0))`;
  };

  if (plan.intent === 'metric_total') {
    return compiled(`SELECT ${ratioFor(plan.current)} AS value`, bag, 'single_value', 'ratio', lineage);
  }

  const current = ratioFor(plan.current);
  const previous = ratioFor(plan.comparison);
  return compiled(
    `SELECT 'current' AS period, ${current} AS value\nUNION ALL\nSELECT 'previous' AS period, ${previous} AS value\nORDER BY period`,
    bag,
    'period_comparison',
    'ratio',
    lineage
  );
}

function scalarAggregate(definition, exclusionSets, period, workspace, bag) {
  assertSourceBoundary(definition, workspace);
  const table = qualifiedTable(definition.source);
  const occurredAt = quoteIdentifier(definition.timestampColumn);
  const conditions = [
    ...compileDefinitionConditions(definition, exclusionSets, bag),
    ...compilePeriodConditions(occurredAt, period, bag)
  ];
  return `(SELECT ${aggregateExpression(definition)}::double precision FROM ${table} WHERE ${conditions.join(' AND ')})`;
}

function aggregateExpression(definition) {
  if (definition.aggregation.type === 'distinct_count') {
    return `COUNT(DISTINCT ${quoteIdentifier(definition.aggregation.column)})`;
  }
  if (definition.aggregation.type === 'event_count') return 'COUNT(*)';
  throw new MetricmindError('UNSUPPORTED_SEMANTIC_AGGREGATION', 'Only count components can be compiled directly.');
}

function compileDefinitionConditions(definition, exclusionSets, bag) {
  const conditions = (definition.predicates ?? []).map((predicate) => compilePredicate(predicate, bag));
  for (const exclusionSet of exclusionSets ?? []) {
    if (!Array.isArray(exclusionSet.rules) || exclusionSet.rules.length === 0) continue;
    const rules = exclusionSet.rules.map((rule) => compilePredicate(rule, bag));
    conditions.push(`NOT (${rules.join(' AND ')})`);
  }
  return conditions.length ? conditions : ['TRUE'];
}

function compilePredicate(predicate, bag) {
  const column = quoteIdentifier(predicate.column);
  switch (predicate.operator) {
    case 'equals':
      return `${column} = ${bag.add(predicate.value)}`;
    case 'not_equals':
      return `${column} <> ${bag.add(predicate.value)}`;
    case 'in':
      if (predicate.value.length === 0) return 'FALSE';
      return `${column} IN (${predicate.value.map((value) => bag.add(value)).join(', ')})`;
    case 'not_in':
      if (predicate.value.length === 0) return 'TRUE';
      return `${column} NOT IN (${predicate.value.map((value) => bag.add(value)).join(', ')})`;
    case 'is_null':
      return `${column} IS NULL`;
    case 'is_not_null':
      return `${column} IS NOT NULL`;
    default:
      throw new MetricmindError('INVALID_SEMANTIC_PREDICATE', `Unsupported predicate ${predicate.operator}.`);
  }
}

function compilePeriodConditions(occurredAt, period, bag) {
  return [
    `${occurredAt} >= ${bag.add(period.start.toISOString())}::timestamptz`,
    `${occurredAt} < ${bag.add(period.end.toISOString())}::timestamptz`
  ];
}

function assertSourceBoundary(definition, workspace) {
  if (
    definition.source.schema !== workspace.dataSource.schema ||
    definition.source.table !== workspace.dataSource.table ||
    definition.timestampColumn !== workspace.dataSource.columns.occurredAt
  ) {
    throw new MetricmindError('SEMANTIC_SOURCE_NOT_ALLOWLISTED', 'Metric source is outside the configured data-source boundary.');
  }
}

function assertDimensionBoundary(dimension, definition, workspace) {
  if (
    dimension.source.schema !== definition.source.schema ||
    dimension.source.table !== definition.source.table ||
    !Object.values(workspace.dataSource.dimensions).some((item) => item.column === dimension.source.column)
  ) {
    throw new MetricmindError('SEMANTIC_DIMENSION_NOT_ALLOWLISTED', 'Dimension source is outside the configured allowlist.');
  }
}

function qualifiedTable(source) {
  return `${quoteIdentifier(source.schema)}.${quoteIdentifier(source.table)}`;
}

function semanticLineage(plan) {
  return {
    metricId: plan.metric.id,
    metricVersionId: plan.metricVersion.id,
    metricVersionNumber: plan.metricVersion.versionNumber,
    definitionHash: plan.metricVersion.definitionHash,
    entityId: plan.metricVersion.definition.entityId,
    aggregation: plan.metricVersion.definition.aggregation.type,
    source: plan.metricVersion.definition.source,
    timestampColumn: plan.metricVersion.definition.timestampColumn,
    exclusionSetIds: plan.metricVersion.definition.exclusionSetIds ?? [],
    allowedDimensionIds: plan.metricVersion.definition.allowedDimensionIds ?? [],
    dependencies: Object.fromEntries(
      Object.entries(plan.metricDependencies ?? {}).map(([role, dependency]) => [role, {
        metricId: dependency.metric.id,
        metricVersionId: dependency.version.id,
        definitionHash: dependency.version.definitionHash
      }])
    )
  };
}

function compiled(sql, bag, expectedShape, valueKind, semanticLineage) {
  return { sql, params: bag.values, expectedShape, valueKind, semanticLineage };
}

class ParameterBag {
  constructor() {
    this.values = [];
  }

  add(value) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}
