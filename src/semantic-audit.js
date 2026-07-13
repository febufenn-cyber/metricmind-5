import { MetricmindError } from './errors.js';
import { validateSemanticCatalog } from './semantic-catalog.js';

export function auditMetricDraftCreation(catalog, versionId, actorId, now = new Date()) {
  const candidate = structuredClone(catalog);
  const version = candidate.versions.find((item) => item.id === versionId);
  if (!version || version.status !== 'draft') {
    throw new MetricmindError('METRIC_DRAFT_NOT_FOUND', 'A draft metric version is required for creation audit.', undefined, 404);
  }
  if (typeof actorId !== 'string' || actorId.trim().length < 2 || actorId.length > 200) {
    throw new MetricmindError('SEMANTIC_ACTOR_REQUIRED', 'Semantic changes require a valid actor identifier.');
  }
  candidate.auditEvents ??= [];
  candidate.auditEvents.push({
    id: `audit-${candidate.auditEvents.length + 1}-${now.getTime()}`,
    actorId: actorId.trim(),
    action: 'metric_version_draft_created',
    objectType: 'metric_version',
    objectId: version.id,
    metadata: { metricId: version.metricId, versionNumber: version.versionNumber },
    createdAt: now.toISOString()
  });
  validateSemanticCatalog(candidate);
  return { catalog: candidate, version };
}
