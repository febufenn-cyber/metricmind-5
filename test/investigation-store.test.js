import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryInvestigationStore } from '../src/investigation-store.js';

function record(id = 'inv-1', organizationId = 'org-1') {
  return {
    id,
    organizationId,
    status: 'completed',
    question: 'Why did signups drop?',
    metric: { id: 'signup', versionId: 'signup-v1', definitionHash: 'fnv1a64:test' },
    observations: [],
    hypotheses: [],
    evidence: [],
    causalStatus: 'not_established',
    createdAt: '2026-07-13T12:00:00.000Z'
  };
}

test('investigation store isolates organizations and refuses duplicate IDs', async () => {
  const store = new MemoryInvestigationStore();
  await store.save('org-1', record());
  assert.equal((await store.get('org-1', 'inv-1')).metric.id, 'signup');
  assert.equal(await store.get('org-2', 'inv-1'), null);
  await assert.rejects(() => store.save('org-1', record()), (error) => error.code === 'INVESTIGATION_ALREADY_EXISTS');
});

test('investigation store filters by metric and bounds list size', async () => {
  const store = new MemoryInvestigationStore();
  await store.save('org-1', record('inv-1'));
  const purchase = record('inv-2');
  purchase.metric = { id: 'purchase', versionId: 'purchase-v1', definitionHash: 'fnv1a64:purchase' };
  purchase.createdAt = '2026-07-13T13:00:00.000Z';
  await store.save('org-1', purchase);
  const results = await store.list('org-1', { metricId: 'purchase', limit: 1 });
  assert.deepEqual(results.map((item) => item.id), ['inv-2']);
  await assert.rejects(() => store.list('org-1', { limit: 101 }), (error) => error.code === 'INVALID_INVESTIGATION_LIST_LIMIT');
});

test('investigation store rejects causal claims in persisted records', async () => {
  const store = new MemoryInvestigationStore();
  const invalid = record();
  invalid.causalStatus = 'confirmed';
  await assert.rejects(() => store.save('org-1', invalid), (error) => error.code === 'INVALID_CAUSAL_STATUS');
});
