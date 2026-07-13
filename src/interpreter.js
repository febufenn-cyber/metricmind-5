import { MetricmindError } from './errors.js';
import { createSeedSemanticCatalog } from './semantic-catalog.js';
import {
  normalizeSemanticText,
  resolveSemanticDimension,
  resolveSemanticMetric
} from './semantic-resolver.js';

export function interpretQuestion(question, workspace, semanticCatalog = createSeedSemanticCatalog(workspace)) {
  if (typeof question !== 'string' || question.trim().length < 3) {
    throw new MetricmindError('INVALID_QUESTION', 'Enter a product analytics question.');
  }
  if (question.length > 500) {
    throw new MetricmindError('QUESTION_TOO_LONG', 'Questions are limited to 500 characters.');
  }

  const text = normalizeSemanticText(question);
  rejectUnsafeOrUnsupported(text);
  const resolvedMetric = resolveSemanticMetric(text, semanticCatalog);
  if (!resolvedMetric) {
    throw new MetricmindError(
      'UNKNOWN_METRIC',
      'I could not map that question to an active verified metric.',
      { availableMetrics: semanticCatalog.metrics.map((item) => item.name) }
    );
  }
  const dimension = resolveSemanticDimension(text, semanticCatalog, resolvedMetric.version);
  const period = resolvePeriodKind(text);
  const intent = resolveIntent(text, dimension);

  const ambiguities = [];
  if (!hasExplicitTime(text)) {
    ambiguities.push('No time range was provided; using the last 7 complete days.');
  }

  return {
    intent,
    metricId: resolvedMetric.metric.id,
    metricName: resolvedMetric.metric.name,
    metricVersionId: resolvedMetric.version.id,
    metricVersionNumber: resolvedMetric.version.versionNumber,
    definitionHash: resolvedMetric.version.definitionHash,
    period,
    comparison: intent === 'period_comparison',
    dimension: dimension?.id ?? null,
    filters: [],
    timezone: resolvedMetric.version.definition.timePolicy?.timezone ?? workspace.organization.timezone,
    ambiguities,
    confidence: ambiguities.length ? 0.82 : 0.96,
    originalQuestion: question.trim()
  };
}

function resolveIntent(text, dimension) {
  if (/\b(compare|change|changed|increase|increased|decrease|decreased|drop|dropped|week over week|month over month|vs|versus)\b/.test(text)) {
    return 'period_comparison';
  }
  if (dimension && /\b(which|top|most|highest|lowest|rank)\b/.test(text)) return 'ranking';
  if (dimension || /\b(break down|breakdown|by )\b/.test(text)) return 'segmentation';
  if (/\b(trend|daily|weekly|over time|last 30 days)\b/.test(text)) return 'time_series';
  return 'metric_total';
}

function resolvePeriodKind(text) {
  if (text.includes('yesterday')) return 'yesterday';
  if (text.includes('last week') || text.includes('previous week') || text.includes('week over week')) return 'previous_calendar_week';
  if (text.includes('last month') || text.includes('previous month') || text.includes('month over month')) return 'previous_calendar_month';
  if (text.includes('this month')) return 'current_month_to_date';
  if (text.includes('30 days')) return 'last_30_complete_days';
  return 'last_7_complete_days';
}

function hasExplicitTime(text) {
  return /\b(yesterday|week|month|day|days|today|quarter|year)\b/.test(text);
}

function rejectUnsafeOrUnsupported(text) {
  if (/\b(delete|truncate|update|insert|alter|grant|revoke)\b/.test(text) || /\bdrop\s+(table|schema|database|view|function)\b/.test(text)) {
    throw new MetricmindError('WRITE_REQUEST_BLOCKED', 'Metricmind is read-only and will not modify warehouse data.', undefined, 403);
  }
  if (/\b(email addresses?|phone numbers?|passwords?|access tokens?|raw users?|export users?)\b/.test(text)) {
    throw new MetricmindError('PII_REQUEST_BLOCKED', 'Metricmind only returns aggregate analytics and does not export personal data.', undefined, 403);
  }
  if (/\b(why|cause|caused|predict|forecast|likely to churn|sentiment|unhappy)\b/.test(text)) {
    throw new MetricmindError('UNSUPPORTED_INTENT', 'This release supports descriptive analytics, comparisons, trends, and segmentation—not causal or predictive claims.');
  }
}
