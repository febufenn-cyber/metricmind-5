import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

test('health endpoint identifies the Phase 1 trust kernel', async () => {
  const response = await worker.fetch(new Request('https://metricmind.test/health'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', phase: '1-trust-kernel' });
});

test('interpret endpoint returns a structured, non-executing plan', async () => {
  const response = await worker.fetch(new Request('https://metricmind.test/v1/questions/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'Break down signups by platform last week' })
  }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.interpretation.intent, 'segmentation');
  assert.equal(payload.interpretation.dimension, 'platform');
});

test('live question endpoint fails closed without a warehouse binding', async () => {
  const response = await worker.fetch(new Request('https://metricmind.test/v1/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'How many signups happened yesterday?' })
  }));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.error.code, 'WAREHOUSE_NOT_CONFIGURED');
});

test('optional API token protects all endpoints when configured', async () => {
  const response = await worker.fetch(new Request('https://metricmind.test/health'), { API_TOKEN: 'secret' });
  assert.equal(response.status, 401);
});
