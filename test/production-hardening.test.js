import test from 'node:test';
import assert from 'node:assert/strict';
import appWorker from '../src/app-worker.js';
import { correlationId, redact } from '../src/observability.js';
import { enforceRateLimit } from '../src/rate-limit.js';
import { evaluateReadiness } from '../src/readiness.js';

test('redaction removes secrets, bearer tokens, SQL parameters, and credential URLs', () => {
  const safe = redact({
    authorization: 'Bearer abc.def.ghi',
    nested: { password: 'secret', value: 'postgres://user:pass@example.test/database' },
    sql: 'select * from users',
    parameters: ['private']
  });
  assert.equal(safe.authorization, '[redacted]');
  assert.equal(safe.nested.password, '[redacted]');
  assert.match(safe.nested.value, /postgres:\/\/\[redacted\]@example\.test/);
  assert.equal(safe.sql, '[redacted]');
  assert.equal(safe.parameters, '[redacted]');
});

test('correlation IDs accept safe caller values and reject malformed values', () => {
  assert.equal(correlationId(new Request('https://metricmind.test', { headers: { 'X-Correlation-ID': 'request-12345678' } })), 'request-12345678');
  const generated = correlationId(new Request('https://metricmind.test', { headers: { 'X-Correlation-ID': '<script>' } }));
  assert.match(generated, /^[0-9a-f-]{36}$/i);
});

test('production readiness fails closed and becomes ready only with required services', () => {
  const missing = evaluateReadiness({ ENVIRONMENT: 'production', API_TOKEN: 'bootstrap' });
  assert.equal(missing.status, 'not_ready');
  assert.ok(missing.failedCheckIds.includes('bootstrap_disabled'));
  const ready = evaluateReadiness({
    ENVIRONMENT: 'production', AUTH_VERIFIER: {}, MEMBERSHIP_STORE: {}, METADATA_DB: {}, ANALYTICS_DB: {}, RATE_LIMITER: {}
  });
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.failedCheckIds, []);
});

test('rate limiter hashes identity material and returns Retry-After without echoing tokens', async () => {
  let capturedKey;
  const response = await enforceRateLimit(new Request('https://metricmind.test/v1/metrics', {
    headers: { Authorization: 'Bearer extremely-sensitive-token', 'X-Metricmind-Organization': 'org-1', 'CF-Connecting-IP': '203.0.113.1' }
  }), {
    RATE_LIMITER: { async limit(key) { capturedKey = key; return { allowed: false, retryAfterSeconds: 17 }; } }
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '17');
  assert.doesNotMatch(capturedKey, /sensitive|Bearer|org-1|203\.0\.113/);
  assert.match(capturedKey, /^[a-f0-9]{32}$/);
  assert.doesNotMatch(await response.text(), /sensitive-token/);
});

test('memory rate limiting bounds repeated API requests', async () => {
  const request = () => new Request('https://metricmind.test/v1/session', {
    headers: { Authorization: 'Bearer rate-test-unique-token', 'X-Metricmind-Organization': 'rate-test-org', 'CF-Connecting-IP': '203.0.113.55' }
  });
  assert.equal(await enforceRateLimit(request(), { API_RATE_LIMIT_PER_MINUTE: '2' }), null);
  assert.equal(await enforceRateLimit(request(), { API_RATE_LIMIT_PER_MINUTE: '2' }), null);
  assert.equal((await enforceRateLimit(request(), { API_RATE_LIMIT_PER_MINUTE: '2' })).status, 429);
});

test('app Worker exposes liveness, readiness, correlation, and redacted structured logs', async () => {
  const logs = [];
  const health = await appWorker.fetch(new Request('https://metricmind.test/health', { headers: { 'X-Correlation-ID': 'health-12345678' } }), {
    LOG_SINK: { async write(event) { logs.push(event); } }
  });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('X-Correlation-ID'), 'health-12345678');
  assert.equal((await health.json()).phase, '8-production-v1');
  assert.equal(logs[0].path, '/health');
  assert.equal(logs[0].correlationId, 'health-12345678');

  const notReady = await appWorker.fetch(new Request('https://metricmind.test/ready'), { ENVIRONMENT: 'production', LOG_LEVEL: 'silent' });
  assert.equal(notReady.status, 503);
  const ready = await appWorker.fetch(new Request('https://metricmind.test/ready'), {
    ENVIRONMENT: 'production', AUTH_VERIFIER: {}, MEMBERSHIP_STORE: {}, METADATA_DB: {}, ANALYTICS_DB: {}, RATE_LIMITER: {}, LOG_LEVEL: 'silent'
  });
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).status, 'ready');
});

test('lightweight liveness load stays successful and uniquely correlated', async () => {
  const responses = await Promise.all(Array.from({ length: 50 }, (_, index) => appWorker.fetch(new Request('https://metricmind.test/health', {
    headers: { 'X-Correlation-ID': `load-test-${String(index).padStart(4, '0')}` }
  }), { LOG_LEVEL: 'silent' })));
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(new Set(responses.map((response) => response.headers.get('X-Correlation-ID'))).size, 50);
});
