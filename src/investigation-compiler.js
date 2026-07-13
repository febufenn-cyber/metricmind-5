import { quoteIdentifier } from './config.js';
import { MetricmindError } from './errors.js';

export function compileInvestigationBreakdown(plan, dimension, workspace) {
  const definition = plan.metricVersion.definition;
  if (!['distinct_count', 'event_count'].includes(definition.aggregation.type)) {
    throw new MetricmindError('UNSUPPORTED_INVESTIGATION_AGGREGATION', 'Segment investigation supports count metrics only.');
  }
  assertBoundaries(definition, dimension, workspace);
  const bag = new ParameterBag();
  const table = `${quoteIdentifier(definition.source.schema)}.${quoteIdentifier(definition.source.table)}`;
  const timestamp = quoteIdentifier(definition.timestampColumn);
  const segment = quoteIdentifier(dimension.source.column);
  const currentWindow = periodPredicate(timestamp, plan.current, bag);
  const previousWindow = periodPredicate(timestamp, plan.comparison, bag);
  const allWindow = `${timestamp} >= ${bag.add(plan.comparison.start.toISOString())}::timestamptz AND ${timestamp} < ${bag.add(plan.current.end.toISOString())}::timestamptz`;
  const baseConditions = compileDefinitionConditions(definition, plan.exclusionSets, bag);
  const currentExpression = aggregateForWindow(definition, currentWindow);
  const previousExpression = aggregateForWindow(definition, previousWindow);

  return {
    sql: `SELECT\n  COALESCE(NULLIF(${segment}::text, ''), 'Unknown') AS segment,\n  ${currentExpression} AS current_value,\n  ${previousExpression} AS previous_value\nFROM ${table}\nWHERE ${baseConditions.join(' AND ')} AND ${allWindow}\nGROUP BY 1\nORDER BY ABS((${currentExpression}) - (${previousExpression})) DESC\nLIMIT ${workspace.dataSource.maximumRows}`,
    params: bag.values,
    expectedShape: 'investigation_breakdown',
    valueKind: 'count',
    semanticLineage: {
      metricId: plan.metric.id,
      metricVersionId: plan.metricVersion.id,
      metricVersionNumber: plan.metricVersion.versionNumber,
      definitionHash: plan.metricVersion.definitionHash,
      dimensionId: dimension.id,
      source: definition.source,
      entityId: definition.entityId,
      exclusionSetIds: definition.exclusionSetIds ?? []
    }
  };
}

function aggregateForWindow(definition, window) {
  if (definition.aggregation.type === 'distinct_count') {
    return `COUNT(DISTINCT ${quoteIdentifier(definition.aggregation.column)}) FILTER (WHERE ${window})`;
  }
  return `COUNT(*) FILTER (WHERE ${window})`;
}

function periodPredicate(timestamp, period, bag) {
  return `${timestamp} >= ${bag.add(period.start.toISOString())}::timestamptz AND ${timestamp} < ${bag.add(period.end.toISOString())}::timestamptz`;
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
    case 'equals': return `${column} = ${bag.add(predicate.value)}`;
    case 'not_equals': return `${column} <> ${bag.add(predicate.value)}`;
    case 'in': return predicate.value.length ? `${column} IN (${predicate.value.map((value) => bag.add(value)).join(', ')})` : 'FALSE';
    case 'not_in': return predicate.value.length ? `${column} NOT IN (${predicate.value.map((value) => bag.add(value)).join(', ')})` : 'TRUE';
    case 'is_null': return `${column} IS NULL`;
    case 'is_not_null': return `${column} IS NOT NULL`;
    default: throw new MetricmindError('INVALID_SEMANTIC_PREDICATE', `Unsupported predicate ${predicate.operator}.`);
  }
}

function assertBoundaries(definition, dimension, workspace) {
  if (
    definition.source.schema !== workspace.dataSource.schema ||
    definition.source.table !== workspace.dataSource.table ||
    definition.timestampColumn !== workspace.dataSource.columns.occurredAt
  ) {
    throw new MetricmindError('SEMANTIC_SOURCE_NOT_ALLOWLISTED', 'Investigation source is outside the configured data-source boundary.');
  }
  if (
    dimension.source.schema !== definition.source.schema ||
    dimension.source.table !== definition.source.table ||
    !(definition.allowedDimensionIds ?? []).includes(dimension.id) ||
    !Object.values(workspace.dataSource.dimensions).some((item) => item.column === dimension.source.column)
  ) {
    throw new MetricmindError('SEMANTIC_DIMENSION_NOT_ALLOWLISTED', 'Investigation dimension is outside the configured allowlist.');
  }
}

class ParameterBag {
  constructor() { this.values = []; }
  add(value) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}
