import { MetricmindError } from './errors.js';

function normalize(value) {
  return value.toLowerCase().replace(/[?.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function interpretQuestion(question, workspace) {
  if (typeof question !== 'string' || question.trim().length < 3) {
    throw new MetricmindError('INVALID_QUESTION', 'Enter a product analytics question.');
  }
  if (question.length > 500) {
    throw new MetricmindError('QUESTION_TOO_LONG', 'Questions are limited to 500 characters.');
  }

  const text = normalize(question);
  rejectUnsafeOrUnsupported(text);
  const metric = resolveMetric(text, workspace.metrics);
  const dimension = resolveDimension(text, workspace.dataSource.dimensions);
  const period = resolvePeriodKind(text);
  const intent = resolveIntent(text, dimension);

  if (!metric) {
    throw new MetricmindError(
      'UNKNOWN_METRIC',
      'I could not map that question to a verified metric.',
      { availableMetrics: workspace.metrics.map((item) => item.name) }
    );
  }

  const ambiguities = [];
  if (!hasExplicitTime(text)) {
    ambiguities.push('No time range was provided; using the last 7 complete days.');
  }

  return {
    intent,
    metricId: metric.id,
    metricName: metric.name,
    period,
    comparison: intent === 'period_comparison',
    dimension: dimension?.id ?? null,
    filters: [],
    timezone: workspace.organization.timezone,
    ambiguities,
    confidence: ambiguities.length ? 0.82 : 0.96,
    originalQuestion: question.trim()
  };
}

function resolveMetric(text, metrics) {
  const candidates = metrics.flatMap((metric) => [metric.name, metric.id, ...(metric.aliases ?? [])]
    .map((alias) => ({ metric, alias: normalize(alias) })))
    .sort((a, b) => b.alias.length - a.alias.length);
  return candidates.find(({ alias }) => containsPhrase(text, alias))?.metric ?? null;
}

function resolveDimension(text, dimensions) {
  for (const [id, definition] of Object.entries(dimensions ?? {})) {
    const names = [id.replaceAll('_', ' '), ...(definition.aliases ?? [])];
    if (names.some((name) => containsPhrase(text, normalize(name)))) return { id, ...definition };
  }
  return null;
}

function containsPhrase(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`).test(text);
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
    throw new MetricmindError('PII_REQUEST_BLOCKED', 'Phase 1 only returns aggregate analytics and does not export personal data.', undefined, 403);
  }
  if (/\b(why|cause|caused|predict|forecast|likely to churn|sentiment|unhappy)\b/.test(text)) {
    throw new MetricmindError('UNSUPPORTED_INTENT', 'Phase 1 supports descriptive analytics, comparisons, trends, and segmentation—not causal or predictive claims.');
  }
}
