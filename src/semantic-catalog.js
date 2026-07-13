import { MetricmindError } from './errors.js';

export const SEMANTIC_VERSION_STATES = Object.freeze([
  'draft',
  'in_review',
  'verified',
  'active',
  'superseded',
  'deprecated'
]);

export const SEMANTIC_AGGREGATIONS = Object.freeze(['distinct_count', 'event_count', 'ratio']);
export const SEMANTIC_HISTORY_POLICIES = Object.freeze(['restated', 'effective_dated']);
export const SEMANTIC_PREDICATE_OPERATORS = Object.freeze([
  'equals',
  'not_equals',
  'in',
  'not_in',
  'is_null',
  'is_not_null'
]);

export function createSeedSemanticCatalog(workspace) {
  const dimensionIds = Object.keys(workspace.dataSource.dimensions ?? {});
  const versions = workspace.metrics.map((metric, index) => {
    const definition = {
      entityId: 'user',
      aggregation: {
        type: 'distinct_count',
        column: workspace.dataSource.columns.userId
      },
      source: {
        schema: workspace.dataSource.schema,
        table: workspace.dataSource.table
      },
      timestampColumn: workspace.dataSource.columns.occurredAt,
      predicates: [{
        column: workspace.dataSource.columns.eventName,
        operator: 'equals',
        value: metric.eventName
      }],
      exclusionSetIds: [],
      allowedDimensionIds: dimensionIds,
      timePolicy: {
        timezone: workspace.organization.timezone,
        completePeriodPolicy: 'exclude_current_day',
        freshnessThresholdMinutes: workspace.dataSource.freshnessThresholdMinutes
      },
      historyPolicy: 'restated'
    };
    return {
      id: `${metric.id}-v1`,
      metricId: metric.id,
      versionNumber: 1,
      status: 'active',
      definition,
      definitionHash: definitionHash(definition),
      createdBy: 'system',
      createdAt: new Date(index).toISOString(),
      verifiedBy: 'system',
      verifiedAt: new Date(index).toISOString(),
      activatedAt: new Date(index).toISOString()
    };
  });

  const catalog = {
    organizationId: workspace.organization.id,
    entities: [{
      id: 'user',
      name: 'User',
      source: {
        schema: workspace.dataSource.schema,
        table: workspace.dataSource.table,
        primaryKeyColumn: workspace.dataSource.columns.userId
      },
      identityNote: 'Counts authenticated user identifiers; anonymous identity stitching is not performed.',
      status: 'verified'
    }],
    dimensions: Object.entries(workspace.dataSource.dimensions ?? {}).map(([id, dimension]) => ({
      id,
      name: titleCase(id),
      source: {
        schema: workspace.dataSource.schema,
        table: workspace.dataSource.table,
        column: dimension.column
      },
      aliases: [...(dimension.aliases ?? [])],
      privacyClassification: 'safe_dimension',
      nullPolicy: 'group_as_unknown',
      maximumCardinality: 100,
      status: 'verified'
    })),
    exclusionSets: [{
      id: 'none',
      name: 'No exclusions',
      description: 'Explicit empty exclusion set used by the seed catalog.',
      rules: [],
      status: 'verified'
    }],
    metrics: workspace.metrics.map((metric) => ({
      id: metric.id,
      key: metric.id,
      name: metric.name,
      description: metric.description,
      aliases: unique([metric.id, metric.name, ...(metric.aliases ?? [])]),
      ownerId: 'system',
      category: 'product',
      createdAt: new Date(0).toISOString()
    })),
    versions,
    dependencies: []
  };

  return validateSemanticCatalog(catalog);
}

export function validateSemanticCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object') {
    throw new MetricmindError('INVALID_SEMANTIC_CATALOG', 'A semantic catalog object is required.');
  }
  if (!catalog.organizationId) {
    throw new MetricmindError('INVALID_SEMANTIC_CATALOG', 'The semantic catalog requires an organization ID.');
  }

  assertUniqueIds(catalog.entities, 'entity');
  assertUniqueIds(catalog.dimensions, 'dimension');
  assertUniqueIds(catalog.exclusionSets, 'exclusion set');
  assertUniqueIds(catalog.metrics, 'metric');
  assertUniqueIds(catalog.versions, 'metric version');

  const entityIds = new Set(catalog.entities.map((item) => item.id));
  const dimensionIds = new Set(catalog.dimensions.map((item) => item.id));
  const exclusionIds = new Set(catalog.exclusionSets.map((item) => item.id));
  const metricIds = new Set(catalog.metrics.map((item) => item.id));

  for (const metric of catalog.metrics) {
    if (!metric.key || !metric.name || !Array.isArray(metric.aliases) || metric.aliases.length === 0) {
      throw new MetricmindError('INVALID_METRIC_IDENTITY', `Metric ${metric.id} requires a key, name, and aliases.`);
    }
  }

  const activeCount = new Map();
  for (const version of catalog.versions) {
    if (!metricIds.has(version.metricId)) {
      throw new MetricmindError('UNKNOWN_METRIC_VERSION_OWNER', `Version ${version.id} references an unknown metric.`);
    }
    if (!SEMANTIC_VERSION_STATES.includes(version.status)) {
      throw new MetricmindError('INVALID_METRIC_VERSION_STATUS', `Version ${version.id} has an invalid status.`);
    }
    if (!Number.isInteger(version.versionNumber) || version.versionNumber < 1) {
      throw new MetricmindError('INVALID_METRIC_VERSION_NUMBER', `Version ${version.id} requires a positive version number.`);
    }
    validateMetricDefinition(version.definition, { entityIds, dimensionIds, exclusionIds, metricIds });
    const expectedHash = definitionHash(version.definition);
    if (version.definitionHash !== expectedHash) {
      throw new MetricmindError('METRIC_DEFINITION_HASH_MISMATCH', `Version ${version.id} definition hash is invalid.`);
    }
    if (version.status === 'active') {
      activeCount.set(version.metricId, (activeCount.get(version.metricId) ?? 0) + 1);
    }
  }

  for (const metric of catalog.metrics) {
    if ((activeCount.get(metric.id) ?? 0) !== 1) {
      throw new MetricmindError('ACTIVE_METRIC_VERSION_REQUIRED', `Metric ${metric.id} must have exactly one active version.`);
    }
  }

  return catalog;
}

export function validateMetricDefinition(definition, references) {
  if (!definition || typeof definition !== 'object') {
    throw new MetricmindError('INVALID_METRIC_DEFINITION', 'Metric definition must be an object.');
  }
  if (!references.entityIds.has(definition.entityId)) {
    throw new MetricmindError('UNKNOWN_SEMANTIC_ENTITY', `Unknown entity ${definition.entityId}.`);
  }
  const aggregation = definition.aggregation;
  if (!aggregation || !SEMANTIC_AGGREGATIONS.includes(aggregation.type)) {
    throw new MetricmindError('UNSUPPORTED_SEMANTIC_AGGREGATION', 'Metric aggregation is unsupported.');
  }
  if (aggregation.type !== 'ratio' && !aggregation.column) {
    throw new MetricmindError('AGGREGATION_COLUMN_REQUIRED', 'Count aggregations require a column.');
  }
  if (aggregation.type === 'ratio') {
    if (!references.metricIds.has(aggregation.numeratorMetricId) || !references.metricIds.has(aggregation.denominatorMetricId)) {
      throw new MetricmindError('INVALID_RATIO_DEPENDENCY', 'Ratio metrics require known numerator and denominator metrics.');
    }
    if (aggregation.numeratorMetricId === aggregation.denominatorMetricId) {
      throw new MetricmindError('INVALID_RATIO_DEPENDENCY', 'Ratio numerator and denominator must differ.');
    }
  }
  if (!definition.source?.schema || !definition.source?.table || !definition.timestampColumn) {
    throw new MetricmindError('INVALID_METRIC_SOURCE', 'Metric source and timestamp column are required.');
  }
  for (const predicate of definition.predicates ?? []) {
    if (!predicate.column || !SEMANTIC_PREDICATE_OPERATORS.includes(predicate.operator)) {
      throw new MetricmindError('INVALID_SEMANTIC_PREDICATE', 'Metric predicate is invalid.');
    }
    const nullOperator = predicate.operator === 'is_null' || predicate.operator === 'is_not_null';
    if (!nullOperator && predicate.value === undefined) {
      throw new MetricmindError('PREDICATE_VALUE_REQUIRED', `Predicate ${predicate.operator} requires a value.`);
    }
    if ((predicate.operator === 'in' || predicate.operator === 'not_in') && !Array.isArray(predicate.value)) {
      throw new MetricmindError('PREDICATE_ARRAY_REQUIRED', `Predicate ${predicate.operator} requires an array value.`);
    }
  }
  for (const id of definition.allowedDimensionIds ?? []) {
    if (!references.dimensionIds.has(id)) {
      throw new MetricmindError('UNKNOWN_SEMANTIC_DIMENSION', `Unknown dimension ${id}.`);
    }
  }
  for (const id of definition.exclusionSetIds ?? []) {
    if (!references.exclusionIds.has(id)) {
      throw new MetricmindError('UNKNOWN_EXCLUSION_SET', `Unknown exclusion set ${id}.`);
    }
  }
  if (!SEMANTIC_HISTORY_POLICIES.includes(definition.historyPolicy)) {
    throw new MetricmindError('INVALID_HISTORY_POLICY', 'Metric history policy is invalid.');
  }
  return definition;
}

export function getActiveMetricVersion(catalog, metricId) {
  const matches = catalog.versions.filter((version) => version.metricId === metricId && version.status === 'active');
  if (matches.length !== 1) {
    throw new MetricmindError('ACTIVE_METRIC_VERSION_REQUIRED', `Metric ${metricId} must have exactly one active version.`);
  }
  return matches[0];
}

export function createMetricDraft(catalog, metricId, definition, actorId) {
  validateSemanticCatalog(catalog);
  if (!actorId) throw new MetricmindError('SEMANTIC_ACTOR_REQUIRED', 'Metric changes require an actor ID.');
  if (!catalog.metrics.some((metric) => metric.id === metricId)) {
    throw new MetricmindError('UNKNOWN_METRIC', `Metric ${metricId} does not exist.`);
  }
  const next = Math.max(0, ...catalog.versions.filter((version) => version.metricId === metricId).map((version) => version.versionNumber)) + 1;
  const draft = {
    id: `${metricId}-v${next}`,
    metricId,
    versionNumber: next,
    status: 'draft',
    definition: structuredClone(definition),
    definitionHash: definitionHash(definition),
    createdBy: actorId,
    createdAt: new Date().toISOString(),
    verifiedBy: null,
    verifiedAt: null,
    activatedAt: null
  };
  const candidate = structuredClone(catalog);
  candidate.versions.push(draft);
  validateMetricDefinition(draft.definition, referenceSets(candidate));
  return { catalog: candidate, draft };
}

export function definitionHash(definition) {
  const text = canonicalJson(definition);
  let hash = 14695981039346656037n;
  const prime = 1099511628211n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

function referenceSets(catalog) {
  return {
    entityIds: new Set(catalog.entities.map((item) => item.id)),
    dimensionIds: new Set(catalog.dimensions.map((item) => item.id)),
    exclusionIds: new Set(catalog.exclusionSets.map((item) => item.id)),
    metricIds: new Set(catalog.metrics.map((item) => item.id))
  };
}

function assertUniqueIds(items, label) {
  if (!Array.isArray(items)) throw new MetricmindError('INVALID_SEMANTIC_CATALOG', `${label} collection must be an array.`);
  const seen = new Set();
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) {
      throw new MetricmindError('DUPLICATE_SEMANTIC_ID', `Duplicate or missing ${label} ID.`);
    }
    seen.add(item.id);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function titleCase(value) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
