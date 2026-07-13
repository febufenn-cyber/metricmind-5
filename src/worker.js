import { defaultWorkspace } from './config.js';
import { createWarehouseExecutor } from './executor.js';
import { asPublicError, MetricmindError } from './errors.js';
import { answerQuestion, interpretOnly } from './pipeline.js';
import { discoverDataSource, getDataSourceFreshness, verifyDataSourceConnection } from './data-source.js';
import { createMetricDraft, getActiveMetricVersion } from './semantic-catalog.js';
import { auditMetricDraftCreation } from './semantic-audit.js';
import {
  activateMetricVersion,
  attachValidationRun,
  submitMetricVersion,
  verifyMetricVersion
} from './semantic-governance.js';
import { createSemanticStore } from './semantic-store.js';
import { evaluateSemanticHealth, previewMetricVersion } from './semantic-validation.js';
import { runInvestigation } from './investigation-engine.js';
import { createInvestigationStore } from './investigation-store.js';
import { reviewInvestigation } from './investigation-review.js';

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    try {
      authenticate(request, env);
      const workspace = workspaceFromEnv(env);
      const semanticStore = createSemanticStore(env, workspace);
      const snapshot = await semanticStore.load(workspace.organization.id);
      const semanticCatalog = snapshot.catalog;
      const investigationStore = createInvestigationStore(env);

      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ status: 'ok', phase: '1-trust-kernel' });
      }

      if (request.method === 'GET' && url.pathname === '/v1/metrics') {
        return json({ metrics: listMetrics(semanticCatalog) });
      }

      if (request.method === 'GET' && url.pathname === '/v1/semantic/metrics') {
        return json({ revision: snapshot.revision, metrics: listMetrics(semanticCatalog) });
      }

      const metricDetail = url.pathname.match(/^\/v1\/semantic\/metrics\/([^/]+)$/);
      if (request.method === 'GET' && metricDetail) {
        const metric = semanticCatalog.metrics.find((item) => item.id === decodeURIComponent(metricDetail[1]));
        if (!metric) throw new MetricmindError('UNKNOWN_METRIC', 'Metric does not exist.', undefined, 404);
        return json({
          revision: snapshot.revision,
          metric,
          versions: semanticCatalog.versions.filter((version) => version.metricId === metric.id),
          validationRuns: (semanticCatalog.validationRuns ?? []).filter((run) => semanticCatalog.versions.some((version) => version.metricId === metric.id && version.id === run.metricVersionId)),
          auditEvents: (semanticCatalog.auditEvents ?? []).filter((event) => event.objectId === metric.id || semanticCatalog.versions.some((version) => version.metricId === metric.id && event.objectId === version.id))
        });
      }

      const createVersion = url.pathname.match(/^\/v1\/semantic\/metrics\/([^/]+)\/versions$/);
      if (request.method === 'POST' && createVersion) {
        const actorId = semanticMutationActor(request, env);
        const body = await readJson(request);
        const drafted = createMetricDraft(semanticCatalog, decodeURIComponent(createVersion[1]), body.definition, actorId);
        const audited = auditMetricDraftCreation(drafted.catalog, drafted.draft.id, actorId);
        const saved = await semanticStore.save(workspace.organization.id, audited.catalog, { expectedRevision: snapshot.revision });
        return json({ revision: saved.revision, draft: audited.version }, 201);
      }

      const versionAction = url.pathname.match(/^\/v1\/semantic\/versions\/([^/]+)\/(submit|validate|verify|activate)$/);
      if (request.method === 'POST' && versionAction) {
        const actorId = semanticMutationActor(request, env);
        const versionId = decodeURIComponent(versionAction[1]);
        const action = versionAction[2];
        let result;
        if (action === 'submit') {
          result = submitMetricVersion(semanticCatalog, versionId, actorId);
        } else if (action === 'validate') {
          const body = await readJson(request);
          const validationRun = await previewMetricVersion({
            catalog: semanticCatalog,
            metricVersionId: versionId,
            workspace,
            executor: createWarehouseExecutor(env),
            now: new Date(),
            period: body.period ?? 'last_7_complete_days',
            expectedValue: body.expectedValue
          });
          result = attachValidationRun(semanticCatalog, validationRun, actorId);
        } else if (action === 'verify') {
          result = verifyMetricVersion(semanticCatalog, versionId, actorId);
        } else {
          result = activateMetricVersion(semanticCatalog, versionId, actorId);
        }
        const saved = await semanticStore.save(workspace.organization.id, result.catalog, { expectedRevision: snapshot.revision });
        return json({
          revision: saved.revision,
          version: result.version ?? null,
          validationRun: result.validationRun ?? null,
          supersededVersionIds: result.supersededVersionIds ?? []
        });
      }

      if (request.method === 'GET' && url.pathname === '/v1/semantic/health') {
        const schema = await discoverDataSource({
          executor: createWarehouseExecutor(env),
          workspace,
          eventLimit: 1,
          eventLookbackDays: 1,
          now: new Date()
        });
        return json({ revision: snapshot.revision, ...evaluateSemanticHealth(semanticCatalog, schema) });
      }

      if (request.method === 'POST' && url.pathname === '/v1/investigations') {
        const body = await readJson(request);
        const executor = createWarehouseExecutor(env);
        const now = new Date();
        const freshness = await getDataSourceFreshness({ executor, workspace, now });
        const schema = await discoverDataSource({
          executor,
          workspace,
          eventLimit: 1,
          eventLookbackDays: 1,
          now
        });
        const semanticHealth = evaluateSemanticHealth(semanticCatalog, schema);
        const investigation = await runInvestigation({
          question: body.question,
          workspace,
          semanticCatalog,
          executor,
          now,
          freshness,
          semanticHealth,
          dimensionIds: body.dimensions,
          maxDimensions: body.maxDimensions ?? 4
        });
        const stored = await investigationStore.save(workspace.organization.id, {
          ...investigation,
          semanticRevision: snapshot.revision,
          requestedBy: request.headers.get('X-Metricmind-Actor') ?? null
        });
        return json({ persistence: investigationStore.mode, investigation: stored }, 201, { 'Cache-Control': 'no-store' });
      }

      if (request.method === 'GET' && url.pathname === '/v1/investigations') {
        const investigations = await investigationStore.list(workspace.organization.id, {
          limit: Number(url.searchParams.get('limit') ?? 20),
          metricId: url.searchParams.get('metricId') ?? undefined
        });
        return json({ persistence: investigationStore.mode, investigations });
      }

      const investigationConclusion = url.pathname.match(/^\/v1\/investigations\/([^/]+)\/conclusion$/);
      if (request.method === 'POST' && investigationConclusion) {
        const actorId = investigationMutationActor(request, env);
        const investigationId = decodeURIComponent(investigationConclusion[1]);
        const existing = await investigationStore.get(workspace.organization.id, investigationId);
        if (!existing) throw new MetricmindError('INVESTIGATION_NOT_FOUND', 'Investigation does not exist.', undefined, 404);
        const body = await readJson(request);
        const reviewed = reviewInvestigation(existing, body, actorId, new Date());
        const updated = await investigationStore.update(workspace.organization.id, investigationId, reviewed.investigation);
        return json({ persistence: investigationStore.mode, investigation: updated, review: reviewed.review });
      }

      const investigationDetail = url.pathname.match(/^\/v1\/investigations\/([^/]+)$/);
      if (request.method === 'GET' && investigationDetail) {
        const investigation = await investigationStore.get(workspace.organization.id, decodeURIComponent(investigationDetail[1]));
        if (!investigation) throw new MetricmindError('INVESTIGATION_NOT_FOUND', 'Investigation does not exist.', undefined, 404);
        return json({ persistence: investigationStore.mode, investigation });
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
        const result = await verifyDataSourceConnection({ executor: createWarehouseExecutor(env), workspace });
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
        const result = await getDataSourceFreshness({ executor: createWarehouseExecutor(env), workspace, now: new Date() });
        return json(result, 200, { 'Cache-Control': 'no-store' });
      }

      throw new MetricmindError('NOT_FOUND', 'Endpoint not found.', undefined, 404);
    } catch (error) {
      const response = asPublicError(error);
      return json(response.body, response.status);
    }
  }
};

function listMetrics(semanticCatalog) {
  return semanticCatalog.metrics.map((metric) => {
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
  });
}

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
      statementTimeoutMs: positiveIntegerEnv(env.ANALYTICS_STATEMENT_TIMEOUT_MS, defaultWorkspace.dataSource.statementTimeoutMs, 'ANALYTICS_STATEMENT_TIMEOUT_MS'),
      maximumRows: positiveIntegerEnv(env.ANALYTICS_MAXIMUM_ROWS, defaultWorkspace.dataSource.maximumRows, 'ANALYTICS_MAXIMUM_ROWS'),
      freshnessThresholdMinutes: positiveIntegerEnv(env.ANALYTICS_FRESHNESS_THRESHOLD_MINUTES, defaultWorkspace.dataSource.freshnessThresholdMinutes, 'ANALYTICS_FRESHNESS_THRESHOLD_MINUTES'),
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

function semanticMutationActor(request, env) {
  if (!env.API_TOKEN) {
    throw new MetricmindError('SEMANTIC_MUTATIONS_DISABLED', 'Configure API_TOKEN and a persistent semantic store before enabling semantic mutations.', undefined, 503);
  }
  const actorId = request.headers.get('X-Metricmind-Actor');
  if (!actorId) throw new MetricmindError('SEMANTIC_ACTOR_REQUIRED', 'X-Metricmind-Actor is required for semantic changes.');
  return actorId;
}

function investigationMutationActor(request, env) {
  if (!env.API_TOKEN) {
    throw new MetricmindError('INVESTIGATION_REVIEWS_DISABLED', 'Configure API_TOKEN before recording investigation reviews.', undefined, 503);
  }
  const actorId = request.headers.get('X-Metricmind-Actor');
  if (!actorId) throw new MetricmindError('INVESTIGATION_ACTOR_REQUIRED', 'X-Metricmind-Actor is required for investigation reviews.');
  return actorId;
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
