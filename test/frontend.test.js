import test from 'node:test';
import assert from 'node:assert/strict';
import appWorker from '../src/app-worker.js';
import { APP_HTML, APP_JS, serveFrontend } from '../src/frontend.js';

test('frontend shell exposes accessible product landmarks and labelled workflows', async () => {
  const response = serveFrontend(new Request('https://metricmind.test/'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Security-Policy'), /default-src 'self'/);
  const html = await response.text();
  for (const fragment of [
    'href="#main"',
    '<nav class="sidebar" aria-label="Primary navigation">',
    '<main id="main"',
    'aria-live="polite"',
    'for="question"',
    'for="investigation-question"',
    'causation'
  ]) assert.ok(html.includes(fragment), `missing ${fragment}`);
});

test('frontend script avoids dynamic HTML execution and exposes all core API flows', () => {
  assert.doesNotMatch(APP_JS, /eval\s*\(|new Function|\.innerHTML\s*=/);
  for (const endpoint of [
    '/v1/session',
    '/v1/data-sources/test',
    '/v1/questions',
    '/v1/investigations',
    '/v1/semantic/metrics',
    '/v1/semantic/health'
  ]) assert.ok(APP_JS.includes(endpoint), `missing ${endpoint}`);
  assert.ok(APP_HTML.includes('Tokens are kept in session storage only.'));
});

test('application Worker serves assets and delegates API routes', async () => {
  const page = await appWorker.fetch(new Request('https://metricmind.test/'));
  assert.equal(page.status, 200);
  assert.match(page.headers.get('Content-Type'), /text\/html/);
  const script = await appWorker.fetch(new Request('https://metricmind.test/assets/app.js'));
  assert.equal(script.status, 200);
  assert.match(script.headers.get('Content-Type'), /text\/javascript/);
  const health = await appWorker.fetch(new Request('https://metricmind.test/health'));
  assert.deepEqual(await health.json(), { status: 'ok', phase: '4-production-identity' });
});

test('unknown frontend paths remain API 404s instead of returning the app shell', async () => {
  assert.equal(serveFrontend(new Request('https://metricmind.test/not-an-asset')), null);
  const response = await appWorker.fetch(new Request('https://metricmind.test/not-an-asset'));
  assert.equal(response.status, 404);
});
