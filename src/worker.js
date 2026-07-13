import { defaultWorkspace } from './config.js';
import { createWarehouseExecutor } from './executor.js';
import { asPublicError, MetricmindError } from './errors.js';
import { answerQuestion, interpretOnly } from './pipeline.js';
import { discoverDataSource, getDataSourceFreshness, verifyDataSourceConnection } from './data-source.js';
import { createSeedSemanticCatalog, getActiveMetricVersion } from './semantic-catalog.js';

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    try {
      authenticate(request, env);
      const workspace = workspaceFromEnv(env);
      const semanticCatalog = createSeedSemanticCatalog(workspace);

      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ status: 'ok', phase: '1-trust-kernel' });
      }

      if (request.method === 'GET' && url.pathname === '/v1/metrics') {
        return json({
          metrics: semanticCatalog.metrics.map((metric) => {
            const version = getActiveMetricVersion(semanticCatalog, metric.id);
            return {
              id: metric.id,
              name: metric.name,
              description: metric.description,
              aliases: metric.aliases,
              version: {
                id: version.id,
                number: version.versionNumber,
                definitionHash: version.definitionHash,
                status: version.status
              }
            };
          })
        });
      }

      if (request.method === 'POST' && url.pathname === '/v1/questions/interpret') {
        const body = await readJson(request);
        return json({ interpretation: interpretOnly({ question: body.question, workspace, semanticCatalog }) });
      }

      if (request.method === 'POST' && url.pathname === '/v1/questions') {
        const body = await readJson(request);
        const executor = createWarehouseExecutor(env);
        const now = new Date();
        const freshness = await getDataSourceFreshness({ executor, workspace, now });
        const result = await answerQuestion({
          question: body.question,
          workspace,
          semanticCatalog,
          executor,
          now,
          freshness
        });
        return json(result, 200, { 'Cache-Control': 'no-store' });
      }

      if (request.method === 'POST' && url.pathname === '/v1/data-sources/test') {
        const result = await verifyDataSourceConnection({
          executor: createWarehouseExecutor(env),
          workspace
        });
        return json(result);
      }

      if (request.method === 'GET' && url.pathname === '/v1/data-sources/schema') {
        const result = await discoverDataSource({
          executor: createWarehouseExecutor(env),
          workspace,
          eventLimit: Number(url.searchParams.get('eventLimit') ?? 50),
          eventLookbackDays: Number(url.searchParams.get('eventLookbackDays') ?? 30),
          now: new Date()
        });
        return json(result);
      }

      if (request.method === 'GET' && url.pathname === '/v1/data-sources/freshness') {
        const result = await getDataSourceFreshness({
          executor: createWarehouseExecutor(env),
          workspace,
          now: new Date()
        });
        return json(result, 200, { 'Cache-Control': 'no-store' });
      }

      throw new MetricmindError('NOT_FOUND', 'Endpoint not found.', undefined, 404);
    } catch (error) {
      const response = asPublicError(error);
      return json(response.body, response.status);
    }
  }
};

export function workspaceFromEnv(env = {}) {
  return {
    ...defaultWorkspace,
    organization: {
      ...defaultWorkspace.organization,
      timezone: env.ORGANIZATION_TIMEZONE || defaultWorkspace.organization.timezone
    },
    dataSource: {
      ...defaultWorkspace.dataSource,
      schema: env.ANALYTICS_SCHEMA || defaultWorkspace.dataSource.schema,
      table: env.ANALYTICS_TABLE || defaultWorkspace.dataSource.table,
      statementTimeoutMs: positiveIntegerEnv(
        env.ANALYTICS_STATEMENT_TIMEOUT_MS,
        defaultWorkspace.dataSource.statementTimeoutMs,
        'ANALYTICS_STATEMENT_TIMEOUT_MS'
      ),
      maximumRows: positiveIntegerEnv(
        env.ANALYTICS_MAXIMUM_ROWS,
        defaultWorkspace.dataSource.maximumRows,
        'ANALYTICS_MAXIMUM_ROWS'
      ),
      freshnessThresholdMinutes: positiveIntegerEnv(
        env.ANALYTICS_FRESHNESS_THRESHOLD_MINUTES,
        defaultWorkspace.dataSource.freshnessThresholdMinutes,
        'ANALYTICS_FRESHNESS_THRESHOLD_MINUTES'
      ),
      columns: {
        ...defaultWorkspace.dataSource.columns,
        eventName: env.ANALYTICS_EVENT_NAME_COLUMN || defaultWorkspace.dataSource.columns.eventName,
        userId: env.ANALYTICS_USER_ID_COLUMN || defaultWorkspace.dataSource.columns.userId,
        occurredAt: env.ANALYTICS_OCCURRED_AT_COLUMN || defaultWorkspace.dataSource.columns.occurredAt,
        insertedAt: optionalColumn(env.ANALYTICS_INSERTED_AT_COLUMN, defaultWorkspace.dataSource.columns.insertedAt)
      }
    }
  };
}

function positiveIntegerEnv(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new MetricmindError('INVALID_ENVIRONMENT_CONFIG', `${name} must be a positive integer.`, undefined, 500);
  }
  return parsed;
}

function optionalColumn(value, fallback) {
  if (value === undefined) return fallback;
  return value === '' || value === 'none' ? null : value;
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
