import { authenticateRequest } from './auth.js';
import { authorize } from './authorization.js';
import { asPublicError, MetricmindError } from './errors.js';
import { createWarehouseExecutor } from './executor.js';
import { assertSafeSql } from './sql-policy.js';
import { resolvePeriod, assertRangeWithinLimit } from './time.js';
import { workspaceFromEnv } from './worker.js';
import { compileMeasure, compileJoinedMeasure, validateJoinPath, verifyMeasureResult } from './advanced-measures.js';
import { compileFunnel, verifyFunnelResult } from './funnel-analytics.js';
import { compileRetention, verifyRetentionResult } from './retention-analytics.js';

const ROUTES = new Map([
  ['/v1/advanced/measures/preview', 'measure'],
  ['/v1/advanced/joined-measures/preview', 'joined_measure'],
  ['/v1/advanced/funnels/preview', 'funnel'],
  ['/v1/advanced/retention/preview', 'retention'],
  ['/v1/advanced/join-paths/validate', 'join_validate']
]);

export async function handleAdvancedRequest(request, env = {}) {
  const kind = ROUTES.get(new URL(request.url).pathname);
  if (!kind) return null;
  try {
    if (request.method !== 'POST') throw new MetricmindError('METHOD_NOT_ALLOWED', 'Use POST for advanced analytics.', undefined, 405);
    const principal = await authenticateRequest(request, env);
    authorize(principal, 'analytics:read');
    const workspace = workspaceFromEnv(env, principal.organizationId);
    workspace.dataSource.verifiedJoinPaths = configuredJoinPaths(env);
    const body = await readJson(request);
    if (kind === 'join_validate') {
      const joinPath = validateJoinPath(body.joinPath, workspace);
      return json({ status: 'verified', joinPath });
    }
    const period = resolvePeriod(body.period ?? 'last_30_complete_days', body.timezone ?? workspace.organization.timezone, new Date());
    assertRangeWithinLimit(period, workspace.dataSource.maximumRangeDays);
    let compiled;
    if (kind === 'measure') compiled = compileMeasure(body.definition, period, workspace);
    if (kind === 'joined_measure') compiled = compileJoinedMeasure(body.definition, period, workspace);
    if (kind === 'funnel') compiled = compileFunnel(body.definition, period, workspace);
    if (kind === 'retention') compiled = compileRetention(body.definition, period, workspace);
    assertSafeSql(compiled, workspace);
    const executor = createWarehouseExecutor(env);
    const execution = await executor.query({
      ...compiled,
      statementTimeoutMs: workspace.dataSource.statementTimeoutMs,
      maximumRows: workspace.dataSource.maximumRows
    });
    const result = kind === 'measure' || kind === 'joined_measure'
      ? verifyMeasureResult(execution)
      : kind === 'funnel'
        ? verifyFunnelResult(compiled, execution, body.definition)
        : verifyRetentionResult(execution);
    return json({
      result,
      evidence: {
        analysisType: kind,
        period: { start: period.start.toISOString(), end: period.end.toISOString(), label: period.label },
        timezone: body.timezone ?? workspace.organization.timezone,
        sql: compiled.sql,
        parameters: compiled.params,
        execution: { durationMs: execution.durationMs, rowCount: execution.rows.length }
      }
    }, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    const response = asPublicError(error);
    return json(response.body, response.status);
  }
}

function configuredJoinPaths(env) {
  if (!env.ANALYTICS_VERIFIED_JOIN_PATHS) return [];
  try {
    const parsed = JSON.parse(env.ANALYTICS_VERIFIED_JOIN_PATHS);
    if (!Array.isArray(parsed)) throw new Error('not array');
    return parsed;
  } catch {
    throw new MetricmindError('INVALID_JOIN_CONFIGURATION', 'ANALYTICS_VERIFIED_JOIN_PATHS must be a JSON array.', undefined, 500);
  }
}

async function readJson(request) {
  if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) {
    throw new MetricmindError('INVALID_CONTENT_TYPE', 'Use application/json.');
  }
  try { return await request.json(); }
  catch { throw new MetricmindError('INVALID_JSON', 'The request body is not valid JSON.'); }
}
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
