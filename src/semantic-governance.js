import { MetricmindError } from './errors.js';
import { validateSemanticCatalog } from './semantic-catalog.js';

export function attachValidationRun(catalog, validationRun, actorId) {
  const candidate = structuredClone(catalog);
  const version = findVersion(candidate, validationRun.metricVersionId);
  candidate.validationRuns ??= [];
  candidate.validationRuns.push({ ...structuredClone(validationRun), createdBy: actorId ?? validationRun.createdBy ?? null });
  appendAudit(candidate, actorId, 'metric_version_validated', 'metric_version', version.id, {
    validationRunId: validationRun.id,
    status: validationRun.status
  });
  validateSemanticCatalog(candidate);
  return { catalog: candidate, validationRun: candidate.validationRuns.at(-1) };
}

export function submitMetricVersion(catalog, versionId, actorId, now = new Date()) {
  return transition(catalog, versionId, actorId, ['draft'], 'in_review', 'metric_version_submitted', now);
}

export function verifyMetricVersion(catalog, versionId, actorId, now = new Date()) {
  const candidate = structuredClone(catalog);
  const version = findVersion(candidate, versionId);
  if (version.status !== 'in_review') {
    throw new MetricmindError('INVALID_SEMANTIC_TRANSITION', 'Only an in-review metric version can be verified.', undefined, 409);
  }
  const latest = latestValidation(candidate, versionId);
  if (!latest || latest.status !== 'passed') {
    throw new MetricmindError('PASSED_VALIDATION_REQUIRED', 'Metric verification requires a latest passed validation run.', undefined, 409);
  }
  version.status = 'verified';
  version.verifiedBy = requiredActor(actorId);
  version.verifiedAt = now.toISOString();
  appendAudit(candidate, actorId, 'metric_version_verified', 'metric_version', version.id, { validationRunId: latest.id });
  validateSemanticCatalog(candidate);
  return { catalog: candidate, version };
}

export function activateMetricVersion(catalog, versionId, actorId, now = new Date()) {
  const candidate = structuredClone(catalog);
  const version = findVersion(candidate, versionId);
  if (version.status !== 'verified') {
    throw new MetricmindError('INVALID_SEMANTIC_TRANSITION', 'Only a verified metric version can be activated.', undefined, 409);
  }
  requiredActor(actorId);
  const replaced = [];
  for (const item of candidate.versions) {
    if (item.metricId === version.metricId && item.status === 'active') {
      item.status = 'superseded';
      replaced.push(item.id);
    }
  }
  version.status = 'active';
  version.activatedAt = now.toISOString();
  appendAudit(candidate, actorId, 'metric_version_activated', 'metric_version', version.id, { supersededVersionIds: replaced });
  validateSemanticCatalog(candidate);
  return { catalog: candidate, version, supersededVersionIds: replaced };
}

export function semanticAuditEvents(catalog) {
  return structuredClone(catalog.auditEvents ?? []);
}

function transition(catalog, versionId, actorId, allowedStatuses, targetStatus, action, now) {
  const candidate = structuredClone(catalog);
  const version = findVersion(candidate, versionId);
  if (!allowedStatuses.includes(version.status)) {
    throw new MetricmindError('INVALID_SEMANTIC_TRANSITION', `Metric version cannot transition from ${version.status} to ${targetStatus}.`, undefined, 409);
  }
  requiredActor(actorId);
  version.status = targetStatus;
  version.updatedAt = now.toISOString();
  appendAudit(candidate, actorId, action, 'metric_version', version.id, { status: targetStatus });
  validateSemanticCatalog(candidate);
  return { catalog: candidate, version };
}

function latestValidation(catalog, versionId) {
  return (catalog.validationRuns ?? [])
    .filter((run) => run.metricVersionId === versionId)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] ?? null;
}

function findVersion(catalog, versionId) {
  const version = catalog.versions.find((item) => item.id === versionId);
  if (!version) throw new MetricmindError('METRIC_VERSION_NOT_FOUND', `Metric version ${versionId} does not exist.`, undefined, 404);
  return version;
}

function appendAudit(catalog, actorId, action, objectType, objectId, metadata) {
  catalog.auditEvents ??= [];
  catalog.auditEvents.push({
    id: `audit-${catalog.auditEvents.length + 1}-${Date.now()}`,
    actorId: requiredActor(actorId),
    action,
    objectType,
    objectId,
    metadata,
    createdAt: new Date().toISOString()
  });
}

function requiredActor(actorId) {
  if (typeof actorId !== 'string' || actorId.trim().length < 2 || actorId.length > 200) {
    throw new MetricmindError('SEMANTIC_ACTOR_REQUIRED', 'Semantic changes require a valid actor identifier.');
  }
  return actorId.trim();
}
