import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkspace } from '../src/config.js';
import { createSeedSemanticCatalog } from '../src/semantic-catalog.js';
import { runInvestigation } from '../src/investigation-engine.js';
import { reviewInvestigation } from '../src/investigation-review.js';
import { MemoryInvestigationStore } from '../src/investigation-store.js';
import worker from '../src/worker.js';

const now = new Date('2026-07-13T12:00:00.000Z');
const fresh = { status: 'fresh', maxInsertedAt: '2026-07-13T11:59:00.000Z', ageMinutes: 1, warning: null };
const healthy = { status: 'healthy', metrics: [{ metricId: 'signup', status: 'healthy', warnings: [] }] };

function baselineExecutor(current, previous, breakdownRows = null) {
  return {
    async query(request) {
      if (request.expectedShape === 'period_comparison') {
        return { rows: [{ period: 'current', value: current }, { period: 'previous', value: previous }], durationMs: 1 };
      }
      if (request.expectedShape === 'investigation_breakdown' && breakdownRows) {
        return { rows: breakdownRows, durationMs: 1 };
      }
      throw new Error('Unexpected query');
    }
  };
}

function storedInvestigation(id = 'investigation-signup-1') {
  return {
    id,
    organizationId: 'demo-org',
    status: 'completed',
    question: 'Why did signups drop last week?',
    metric: { id: 'signup', name: 'Signup', versionId: 'signup-v1', versionNumber: 1, definitionHash: 'fnv1a64:test' },
    observations: [],
    hypotheses: [],
    evidence: [],
    causalStatus: 'not_established',
    createdAt: '2026-07-13T12:00:00.000Z'
  };
}

test('no net movement returns a no-change outcome instead of speculative hypotheses', async () => {
  const result = await runInvestigation({
    question: 'Why are signups different last week?',
    workspace: defaultWorkspace,
    semanticCatalog: createSeedSemanticCatalog(defaultWorkspace),
    executor: baselineExecutor(100, 100),
    now,
    freshness: fresh,
    semanticHealth: healthy,
    dimensionIds: []
  });
  assert.equal(result.status, 'no_change');
  assert.equal(result.hypotheses.length, 1);
  assert.equal(result.hypotheses[0].id, 'hypothesis:no-net-change');
  assert.deepEqual(result.hypotheses[0].evidenceIds, ['baseline']);
});

test('data-quality hypotheses point to explicit evidence objects', async () => {
  const result = await runInvestigation({
    question: 'Why did signups drop last week?',
    workspace: defaultWorkspace,
    semanticCatalog: createSeedSemanticCatalog(defaultWorkspace),
    executor: baselineExecutor(80, 100),
    now,
    freshness: { status: 'stale', ageMinutes: 900, warning: 'Ingestion is stale.' },
    semanticHealth: { status: 'warning', metrics: [{ metricId: 'signup', status: 'warning', warnings: ['Dimension drift detected.'] }] },
    dimensionIds: []
  });
  const ids = new Set(result.evidence.map((item) => item.id));
  assert.ok(ids.has('data-quality:freshness'));
  assert.ok(ids.has('data-quality:semantic-health'));
  assert.deepEqual(result.hypotheses.find((item) => item.id === 'hypothesis:data-delay').evidenceIds, ['data-quality:freshness']);
});

test('segment concentration must move in the same direction as the baseline', async () => {
  const result = await runInvestigation({
    question: 'Why did signups drop last week?',
    workspace: defaultWorkspace,
    semanticCatalog: createSeedSemanticCatalog(defaultWorkspace),
    executor: baselineExecutor(80, 100, [
      { segment: 'opposite', current_value: 60, previous_value: 10 },
      { segment: 'aligned-a', current_value: 20, previous_value: 35 },
      { segment: 'aligned-b', current_value: 10, previous_value: 15 }
    ]),
    now,
    freshness: fresh,
    semanticHealth: healthy,
    dimensionIds: ['platform']
  });
  assert.equal(result.hypotheses.some((item) => item.id === 'hypothesis:platform:concentration'), false);
});

test('human review is append-only and never upgrades causal status', () => {
  const first = reviewInvestigation(storedInvestigation(), { decision: 'accepted', note: 'The segment evidence matches our incident review.' }, 'pm@example.com', now);
  const second = reviewInvestigation(first.investigation, { decision: 'inconclusive' }, 'analyst@example.com', new Date(now.getTime() + 1000));
  assert.equal(second.investigation.reviewHistory.length, 2);
  assert.equal(second.investigation.resolution.decision, 'inconclusive');
  assert.equal(second.investigation.causalStatus, 'not_established');
});

test('worker records an authenticated investigation conclusion', async () => {
  const store = new MemoryInvestigationStore();
  await store.save('demo-org', storedInvestigation());
  const env = { API_TOKEN: 'secret', INVESTIGATION_STORE: store };
  const response = await worker.fetch(new Request('https://metricmind.test/v1/investigations/investigation-signup-1/conclusion', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer secret',
      'Content-Type': 'application/json',
      'X-Metricmind-Actor': 'pm@example.com'
    },
    body: JSON.stringify({ decision: 'accepted', note: 'Confirmed during incident review.' })
  }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.review.decision, 'accepted');
  assert.equal(payload.investigation.reviewHistory.length, 1);
  assert.equal(payload.investigation.causalStatus, 'not_established');
});
