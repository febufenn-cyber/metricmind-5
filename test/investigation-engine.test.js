import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkspace } from '../src/config.js';
import { createSeedSemanticCatalog } from '../src/semantic-catalog.js';
import { runInvestigation } from '../src/investigation-engine.js';

const now = new Date('2026-07-13T12:00:00.000Z');
const healthy = {
  status: 'healthy',
  metrics: [{ metricId: 'signup', status: 'healthy', warnings: [] }]
};
const fresh = {
  status: 'fresh',
  maxInsertedAt: '2026-07-13T11:55:00.000Z',
  ageMinutes: 5,
  warning: null
};

function executor() {
  return {
    calls: [],
    async query(request) {
      this.calls.push(request);
      if (request.expectedShape === 'period_comparison') {
        return {
          rows: [
            { period: 'current', value: 80 },
            { period: 'previous', value: 100 }
          ],
          durationMs: 4
        };
      }
      if (request.semanticLineage?.dimensionId === 'platform') {
        return {
          rows: [
            { segment: 'ios', current_value: 20, previous_value: 50 },
            { segment: 'android', current_value: 35, previous_value: 30 },
            { segment: 'web', current_value: 25, previous_value: 20 }
          ],
          durationMs: 5
        };
      }
      if (request.semanticLineage?.dimensionId === 'source') {
        return {
          rows: [
            { segment: 'paid', current_value: 10, previous_value: 35 },
            { segment: 'organic', current_value: 45, previous_value: 40 },
            { segment: 'referral', current_value: 25, previous_value: 25 }
          ],
          durationMs: 6
        };
      }
      throw new Error('Unexpected investigation query');
    }
  };
}

test('investigates a verified metric change with bounded aggregate evidence', async () => {
  const warehouse = executor();
  const result = await runInvestigation({
    question: 'Why did signups drop last week?',
    workspace: defaultWorkspace,
    semanticCatalog: createSeedSemanticCatalog(defaultWorkspace),
    executor: warehouse,
    now,
    freshness: fresh,
    semanticHealth: healthy,
    dimensionIds: ['platform', 'source']
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.metric.versionId, 'signup-v1');
  assert.equal(result.baseline.absoluteChange, -20);
  assert.equal(result.causalStatus, 'not_established');
  assert.equal(result.evidence.length, 3);
  assert.ok(result.hypotheses.some((hypothesis) => hypothesis.type === 'association'));
  assert.ok(result.hypotheses.every((hypothesis) => hypothesis.causalStatus === 'not_established'));
  assert.equal(result.confidence.level, 'high');
  const platform = result.evidence.find((item) => item.id === 'dimension:platform');
  assert.equal(platform.finding.segments[0].segment, 'ios');
  assert.equal(platform.finding.reconciliation.additive, false);
  assert.equal(warehouse.calls.length, 3);
});

test('stale ingestion limits the investigation and produces a data-quality hypothesis', async () => {
  const result = await runInvestigation({
    question: 'What caused signups to drop last week?',
    workspace: defaultWorkspace,
    semanticCatalog: createSeedSemanticCatalog(defaultWorkspace),
    executor: executor(),
    now,
    freshness: { status: 'stale', ageMinutes: 900, warning: 'Data ingestion is 900 minutes behind.' },
    semanticHealth: healthy,
    dimensionIds: ['platform']
  });
  assert.equal(result.status, 'limited');
  assert.equal(result.confidence.level, 'low');
  assert.ok(result.hypotheses.some((hypothesis) => hypothesis.id === 'hypothesis:data-delay'));
});

test('invalid semantic health blocks investigation before warehouse execution', async () => {
  let calls = 0;
  await assert.rejects(
    () => runInvestigation({
      question: 'Why did signups drop last week?',
      workspace: defaultWorkspace,
      semanticCatalog: createSeedSemanticCatalog(defaultWorkspace),
      executor: { async query() { calls += 1; return { rows: [], durationMs: 1 }; } },
      now,
      freshness: fresh,
      semanticHealth: {
        status: 'invalid',
        metrics: [{ metricId: 'signup', status: 'invalid', missingCoreColumns: ['user_id'] }]
      },
      dimensionIds: ['platform']
    }),
    (error) => error.code === 'INVESTIGATION_METRIC_UNHEALTHY'
  );
  assert.equal(calls, 0);
});
