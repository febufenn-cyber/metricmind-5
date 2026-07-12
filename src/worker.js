import { defaultWorkspace } from './config.js';
import { BindingQueryExecutor } from './executor.js';
import { asPublicError, MetricmindError } from './errors.js';
import { answerQuestion, interpretOnly } from './pipeline.js';

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    try {
      authenticate(request, env);

      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ status: 'ok', phase: '1-trust-kernel' });
      }

      if (request.method === 'GET' && url.pathname === '/v1/metrics') {
        return json({ metrics: defaultWorkspace.metrics.map(({ eventName: _eventName, ...metric }) => metric) });
      }

      if (request.method === 'POST' && url.pathname === '/v1/questions/interpret') {
        const body = await readJson(request);
        return json({ interpretation: interpretOnly({ question: body.question, workspace: workspaceFromEnv(env) }) });
      }

      if (request.method === 'POST' && url.pathname === '/v1/questions') {
        const body = await readJson(request);
        const result = await answerQuestion({
          question: body.question,
          workspace: workspaceFromEnv(env),
          executor: new BindingQueryExecutor(env.ANALYTICS_DB),
          now: new Date()
        });
        return json(result, 200, { 'Cache-Control': 'no-store' });
      }

      if (request.method === 'POST' && url.pathname === '/v1/data-sources/test') {
        const executor = new BindingQueryExecutor(env.ANALYTICS_DB);
        const result = await executor.query({
          sql: 'SELECT 1 AS value',
          params: ['connection-test'],
          plan: null,
          statementTimeoutMs: 2_000,
          maximumRows: 1
        });
        return json({ status: 'connected', durationMs: result.durationMs });
      }

      throw new MetricmindError('NOT_FOUND', 'Endpoint not found.', undefined, 404);
    } catch (error) {
      const response = asPublicError(error);
      return json(response.body, response.status);
    }
  }
};

function workspaceFromEnv(env) {
  return {
    ...defaultWorkspace,
    organization: {
      ...defaultWorkspace.organization,
      timezone: env.ORGANIZATION_TIMEZONE || defaultWorkspace.organization.timezone
    }
  };
}

function authenticate(request, env) {
  if (!env.API_TOKEN) return;
  const authorization = request.headers.get('Authorization');
  if (authorization !== `Bearer ${env.API_TOKEN}`) {
    throw new MetricmindError('UNAUTHORIZED', 'A valid bearer token is required.', undefined, 401);
  }
}

async function readJson(request) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    throw new MetricmindError('INVALID_CONTENT_TYPE', 'Use application/json.');
  }
  try {
    return await request.json();
  } catch {
    throw new MetricmindError('INVALID_JSON', 'The request body is not valid JSON.');
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}
