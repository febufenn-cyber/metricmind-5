import { MetricmindError } from './errors.js';
import { getActiveMetricVersion, validateSemanticCatalog } from './semantic-catalog.js';

export function normalizeSemanticText(value) {
  return String(value).toLowerCase().replace(/[?.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function containsSemanticPhrase(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`).test(text);
}

export function resolveSemanticMetric(text, catalog) {
  validateSemanticCatalog(catalog);
  const matches = [];
  for (const metric of catalog.metrics) {
    for (const rawAlias of [metric.key, metric.name, ...(metric.aliases ?? [])]) {
      const alias = normalizeSemanticText(rawAlias);
      if (alias && containsSemanticPhrase(text, alias)) {
        matches.push({ metric, alias, score: alias.length });
      }
    }
  }
  if (matches.length === 0) return null;

  const highestScore = Math.max(...matches.map((match) => match.score));
  const candidates = new Map();
  for (const match of matches.filter((item) => item.score === highestScore)) {
    candidates.set(match.metric.id, match.metric);
  }
  if (candidates.size > 1) {
    throw new MetricmindError(
      'AMBIGUOUS_METRIC',
      'The question matches more than one verified metric.',
      { candidates: [...candidates.values()].map(({ id, name }) => ({ id, name })) }
    );
  }

  const metric = [...candidates.values()][0];
  return { metric, version: getActiveMetricVersion(catalog, metric.id) };
}

export function resolveSemanticDimension(text, catalog, metricVersion) {
  const matches = [];
  for (const dimension of catalog.dimensions.filter((item) => item.status === 'verified')) {
    for (const rawAlias of [dimension.id.replaceAll('_', ' '), dimension.name, ...(dimension.aliases ?? [])]) {
      const alias = normalizeSemanticText(rawAlias);
      if (alias && containsSemanticPhrase(text, alias)) {
        matches.push({ dimension, alias, score: alias.length });
      }
    }
  }
  if (matches.length === 0) return null;

  const highestScore = Math.max(...matches.map((match) => match.score));
  const candidates = new Map();
  for (const match of matches.filter((item) => item.score === highestScore)) {
    candidates.set(match.dimension.id, match.dimension);
  }
  if (candidates.size > 1) {
    throw new MetricmindError(
      'AMBIGUOUS_DIMENSION',
      'The question matches more than one verified dimension.',
      { candidates: [...candidates.values()].map(({ id, name }) => ({ id, name })) }
    );
  }

  const dimension = [...candidates.values()][0];
  if (!(metricVersion.definition.allowedDimensionIds ?? []).includes(dimension.id)) {
    throw new MetricmindError(
      'DIMENSION_NOT_ALLOWED_FOR_METRIC',
      `Dimension ${dimension.name} is not approved for this metric.`
    );
  }
  return dimension;
}
