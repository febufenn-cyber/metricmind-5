import test from 'node:test';
import assert from 'node:assert/strict';
import appWorker from '../src/app-worker.js';
import { evaluateAlert, monitoringWindow, composeMonitoringBrief } from '../src/monitoring.js';
import { MemoryMonitoringStore } from '../src/monitoring-store.js';
import { deliverNotification } from '../src/notifications.js';

function rule(overrides = {}) {
  return {
    id: 'signups-low', organizationId: 'demo-org', name: 'Low signups', question: 'How many signups happened yesterday?',
    kind: 'threshold', cadence: 'daily', condition: { operator: 'less_than', value: 100 }, cooldownMinutes: 60,
    destinations: [{ id: 'growth-alerts', type: 'slack', verified: true }], enabled: true,
    ...overrides
  };
}

test('stale ingestion suppresses business alerts while missing-data rules can trigger', () => {
  const suppressed = evaluateAlert(rule(), { value: 10 }, { freshness: { status: 'stale', ageMinutes: 90 } });
  assert.equal(suppressed.status, 'suppressed');
  assert.equal(suppressed.triggered, false);
  const missing = evaluateAlert(rule({ kind: 'missing_data', condition: { statuses: ['stale', 'error'] } }), {}, { freshness: { status: 'stale', ageMinutes: 90 } });
  assert.equal(missing.triggered, true);
});

test('threshold, anomaly, and cooldown evaluation are deterministic', () => {
  assert.equal(evaluateAlert(rule(), { value: 50 }, { freshness: { status: 'fresh' } }).triggered, true);
  const anomaly = evaluateAlert(rule({ kind: 'anomaly', condition: { zScore: 2 } }), { value: 40, baselineValues: [10, 10, 11, 9, 10, 11, 9] }, { freshness: { status: 'fresh' } });
  assert.equal(anomaly.triggered, true);
  const cooldown = evaluateAlert(rule(), { value: 50 }, { freshness: { status: 'fresh' }, lastTriggeredAt: '2026-07-14T05:30:00Z', now: new Date('2026-07-14T06:00:00Z') });
  assert.equal(cooldown.status, 'cooldown');
});

test('schedule windows and store claims prevent duplicate execution', async () => {
  const window = monitoringWindow(rule(), new Date('2026-07-14T08:45:00Z'));
  assert.equal(window.start, '2026-07-14T00:00:00.000Z');
  const store = new MemoryMonitoringStore();
  assert.equal(await store.claim('signups-low', window.idempotencyKey), true);
  assert.equal(await store.claim('signups-low', window.idempotencyKey), false);
});

test('notification delivery retries and records a terminal dead letter', async () => {
  let attempts = 0;
  const failed = await deliverNotification({ id: 'growth-alerts', type: 'slack', verified: true }, { title: 'Alert' }, {
    SLACK_NOTIFIER: { async send() { attempts += 1; throw new Error('provider unavailable'); } }
  }, { attempts: 3, idempotencyKey: 'window-1' });
  assert.equal(attempts, 3);
  assert.equal(failed.status, 'dead_letter');
  const delivered = await deliverNotification({ id: 'ops-email', type: 'email', verified: true }, { title: 'Alert' }, {
    EMAIL_NOTIFIER: { async send(input) { assert.equal(input.destinationId, 'ops-email'); return { id: 'delivery-1' }; } }
  });
  assert.equal(delivered.status, 'delivered');
});

test('briefs preserve evidence references and non-causal status', () => {
  const brief = composeMonitoringBrief([{ ruleId: 'r1', name: 'Rule', evaluation: { status: 'triggered', triggered: true, reason: 'Observed movement.' }, evidenceId: 'e1' }], new Date('2026-07-14T00:00:00Z'));
  assert.equal(brief.causalStatus, 'not_established');
  assert.equal(brief.items[0].evidenceId, 'e1');
});

test('monitoring API stores rules only through durable authenticated binding', async () => {
  const rules = [];
  const binding = {
    async saveRule(_org, item) { rules.push(item); return item; },
    async listRules() { return rules; }, async listDue() { return []; }, async claim() { return true; }, async complete() {}, async latestTriggered() { return null; }, async recordDelivery(item) { return item; }, async listDeliveries() { return []; }
  };
  const response = await appWorker.fetch(new Request('https://metricmind.test/v1/monitoring/rules', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' }, body: JSON.stringify(rule({ organizationId: undefined }))
  }), { API_TOKEN: 'secret', MONITORING_STORE: binding });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).rule.id, 'signups-low');
});
