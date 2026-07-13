import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkspace } from '../src/config.js';
import { StaticExecutor } from '../src/executor.js';
import { createMetricDraft, createSeedSemanticCatalog } from '../src/semantic-catalog.js';
import {
  activateMetricVersion,
  attachValidationRun,
  submitMetricVersion,
  verifyMetricVersion
} from '../src/semantic-governance.js';
import { MemorySemanticStore } from '../src/semantic-store.js';
import { evaluateSemanticHealth, previewMetricVersion } from '../src/semantic-validation.js';
import worker from '../src/worker.js';

function catalog() {
  return createSeedSemanticCatalog(structuredClone(defaultWorkspace));
}

function draftSignup(semantic) {
  const active = semantic.versions.find((version) => version.metricId === 'signup' && version.status === 'active');
  const definition = structuredClone(active.definition);
  definition.predicates[0].value = 'email_verified';
  return createMetricDraft(semantic, 'signup', definition, 'editor-1');
}

test('governance requires validation, verification, and activation in order', () => {
  const draft = draftSignup(catalog());
  assert.throws(
    () => verifyMetricVersion(draft.catalog, draft.draft.id, 'approver-1'),
    (error) => error.code === 'INVALID_SEMANTIC_TRANSITION'
  );
  const submitted = submitMetricVersion(draft.catalog, draft.draft.id, 'editor-1', new Date('2026-07-13T00:00:00Z'));
  assert.throws(
    () => verifyMetricVersion(submitted.catalog, draft.draft.id, 'approver-1'),
    (error) => error.code === 'PASSED_VALIDATION_REQUIRED'
  );
  const attached = attachValidationRun(submitted.catalog, {
    id: 'validation-1',
    metricVersionId: draft.draft.id,
    status: 'passed',
    checks: [],
    previewResults: { value: 10 },
    createdAt: '2026-07-13T00:01:00Z'
  }, 'analyst-1');
  const verified = verifyMetricVersion(attached.catalog, draft.draft.id, 'approver-1', new Date('2026-07-13T00:02:00Z'));
  const activated = activateMetricVersion(verified.catalog, draft.draft.id, 'approver-1', new Date('2026-07-13T00:03:00Z'));
  assert.equal(activated.version.status, 'active');
  assert.deepEqual(activated.supersededVersionIds, ['signup-v1']);
  assert.equal(activated.catalog.versions.find((version) => version.id === 'signup-v1').status, 'superseded');
  assert.ok(activated.catalog.auditEvents.length >= 4);
});

test('preview executes a draft definition through the safe compiler', async () => {
  const draft = draftSignup(catalog());
  const executor = new StaticExecutor(async ({ params }) => {
    assert.equal(params[0], 'email_verified');
    return [{ value: 14 }];
  });
  const run = await previewMetricVersion({
    catalog: draft.catalog,
    metricVersionId: draft.draft.id,
    workspace: defaultWorkspace,
    executor,
    now: new Date('2026-07-13T00:00:00Z'),
    expectedValue: 14
  });
  assert.equal(run.status, 'passed');
  assert.equal(run.previewResults.expectedMatch, true);
  assert.equal(run.previewResults.semanticLineage.metricVersionId, draft.draft.id);
});

test('semantic store rejects stale revision writes', async () => {
  const store = new MemorySemanticStore(catalog());
  const first = await store.load(defaultWorkspace.organization.id);
  await store.save(defaultWorkspace.organization.id, first.catalog, { expectedRevision: first.revision });
  await assert.rejects(
    () => store.save(defaultWorkspace.organization.id, first.catalog, { expectedRevision: first.revision }),
    { code: 'SEMANTIC_REVISION_CONFLICT' }
  );
});

test('semantic health marks metrics invalid when core columns disappear', () => {
  const health = evaluateSemanticHealth(catalog(), {
    columns: [
      { name: 'event_name' },
      { name: 'occurred_at' },
      { name: 'platform' },
      { name: 'source' },
      { name: 'country' },
      { name: 'app_version' }
    ],
    mapping: { restrictedColumnsPresent: [] }
  });
  assert.equal(health.status, 'invalid');
  assert.ok(health.metrics.every((metric) => metric.missingCoreColumns.includes('user_id')));
});

test('worker creates and audits a semantic draft only with authenticated persistent storage', async () => {
  const semantic = catalog();
  const store = new MemorySemanticStore(semantic);
  const active = semantic.versions.find((version) => version.metricId === 'signup');
  const definition = structuredClone(active.definition);
  definition.predicates[0].value = 'email_verified';
  const response = await worker.fetch(new Request('https://metricmind.test/v1/semantic/metrics/signup/versions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer secret',
      'Content-Type': 'application/json',
      'X-Metricmind-Actor': 'editor-1'
    },
    body: JSON.stringify({ definition })
  }), {
    API_TOKEN: 'secret',
    SEMANTIC_STORE: store
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.revision, 2);
  assert.equal(payload.draft.status, 'draft');
  const stored = await store.load(defaultWorkspace.organization.id);
  assert.ok(stored.catalog.auditEvents.some((event) => event.action === 'metric_version_draft_created' && event.objectId === payload.draft.id));
});
