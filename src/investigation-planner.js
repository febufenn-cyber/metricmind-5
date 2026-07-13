import { MetricmindError } from './errors.js';
import { interpretQuestion } from './interpreter.js';
import { buildQueryPlan } from './planner.js';
import { validateSemanticCatalog } from './semantic-catalog.js';

const DEFAULT_MAX_DIMENSIONS = 4;
const HARD_MAX_DIMENSIONS = 6;

export function buildInvestigationPlan({
  question,
  workspace,
  semanticCatalog,
  now = new Date(),
  dimensionIds,
  maxDimensions = DEFAULT_MAX_DIMENSIONS
}) {
  validateSemanticCatalog(semanticCatalog);
  const normalizedQuestion = normalizeInvestigationQuestion(question);
  const interpreted = interpretQuestion(normalizedQuestion, workspace, semanticCatalog);
  const interpretation = {
    ...interpreted,
    intent: 'period_comparison',
    comparison: true,
    dimension: null,
    originalQuestion: String(question).trim()
  };
  const baselinePlan = buildQueryPlan(interpretation, workspace, now, semanticCatalog);
  const limit = boundedDimensionLimit(maxDimensions);
  const dimensions = selectDimensions({
    requestedIds: dimensionIds,
    semanticCatalog,
    metricVersion: baselinePlan.metricVersion,
    limit
  });
  const warnings = [];
  if (baselinePlan.metricVersion.definition.aggregation.type === 'ratio') {
    warnings.push('Ratio metrics are investigated at the baseline level only in this phase; segment decomposition is skipped.');
  }
  if (dimensions.length === 0 && baselinePlan.metricVersion.definition.aggregation.type !== 'ratio') {
    warnings.push('No verified dimensions are approved for this metric, so the investigation is limited to the baseline comparison.');
  }

  return {
    kind: 'metric_change_investigation',
    question: String(question).trim(),
    normalizedQuestion,
    interpretation,
    baselinePlan,
    dimensions: baselinePlan.metricVersion.definition.aggregation.type === 'ratio' ? [] : dimensions,
    warnings,
    limits: {
      maximumDimensions: limit,
      aggregateOnly: true,
      causalClaimsAllowed: false
    }
  };
}

export function normalizeInvestigationQuestion(question) {
  if (typeof question !== 'string' || question.trim().length < 3) {
    throw new MetricmindError('INVALID_INVESTIGATION_QUESTION', 'Enter a metric-change investigation question.');
  }
  if (question.length > 500) {
    throw new MetricmindError('QUESTION_TOO_LONG', 'Investigation questions are limited to 500 characters.');
  }
  const original = question.trim();
  if (/\b(predict|forecast|future|likely to churn|sentiment|unhappy)\b/i.test(original)) {
    throw new MetricmindError('UNSUPPORTED_INVESTIGATION_INTENT', 'Phase 3 investigates observed metric changes and does not predict future behaviour.');
  }
  let normalized = original
    .replace(/^\s*(explain\s+)?why\s+(did|has|have|is|are|was|were)\s+/i, '')
    .replace(/^\s*(what|which)\s+caused\s+/i, '')
    .replace(/^\s*(find|identify)\s+(the\s+)?(reason|cause)\s+(for|behind)\s+/i, '')
    .replace(/^\s*investigate\s+(why\s+)?/i, '')
    .trim();
  if (!/\b(compare|change|changed|increase|increased|decrease|decreased|drop|dropped|decline|declined|rise|rose|week over week|month over month|vs|versus)\b/i.test(normalized)) {
    normalized = `Compare ${normalized}`;
  }
  return normalized;
}

function selectDimensions({ requestedIds, semanticCatalog, metricVersion, limit }) {
  const allowed = new Set(metricVersion.definition.allowedDimensionIds ?? []);
  const verified = semanticCatalog.dimensions.filter((dimension) =>
    dimension.status === 'verified' &&
    allowed.has(dimension.id) &&
    dimension.source?.schema === metricVersion.definition.source.schema &&
    dimension.source?.table === metricVersion.definition.source.table
  );
  if (requestedIds === undefined || requestedIds === null) return verified.slice(0, limit);
  if (!Array.isArray(requestedIds)) {
    throw new MetricmindError('INVALID_INVESTIGATION_DIMENSIONS', 'dimensions must be an array of verified dimension IDs.');
  }
  const ids = [...new Set(requestedIds.map((value) => String(value).trim()).filter(Boolean))];
  if (ids.length > limit) {
    throw new MetricmindError('TOO_MANY_INVESTIGATION_DIMENSIONS', `At most ${limit} dimensions may be investigated at once.`);
  }
  return ids.map((id) => {
    const dimension = verified.find((item) => item.id === id);
    if (!dimension) {
      throw new MetricmindError('DIMENSION_NOT_ALLOWED_FOR_METRIC', `Dimension ${id} is not verified and approved for this metric.`);
    }
    return dimension;
  });
}

function boundedDimensionLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > HARD_MAX_DIMENSIONS) {
    throw new MetricmindError('INVALID_INVESTIGATION_LIMIT', `maxDimensions must be an integer between 1 and ${HARD_MAX_DIMENSIONS}.`);
  }
  return parsed;
}
