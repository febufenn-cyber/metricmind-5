import { authenticateRequest } from './auth.js';
import { authorize } from './authorization.js';
import { asPublicError, MetricmindError } from './errors.js';
import { createMonitoringStore } from './monitoring-store.js';
import { evaluateAlert, validateMonitoringRule } from './monitoring.js';

export async function handleMonitoringRequest(request, env = {}) {
  const url = new URL(request.url);
  const known = url.pathname === '/v1/monitoring/rules'
    || url.pathname === '/v1/monitoring/deliveries'
    || /^\/v1\/monitoring\/rules\/[^/]+\/evaluate$/.test(url.pathname);
  if (!known) return null;
  try {
    const principal = await authenticateRequest(request, env);
    const store = createMonitoringStore(env);
    if (url.pathname === '/v1/monitoring/rules' && request.method === 'GET') {
      authorize(principal, 'analytics:read');
      return json({ persistence: store.mode, rules: await store.listRules(principal.organizationId) });
    }
    if (url.pathname === '/v1/monitoring/rules' && request.method === 'POST') {
      authorize(principal, 'organization:admin');
      if (store.mode === 'ephemeral') throw new MetricmindError('DURABLE_STORE_REQUIRED', 'Monitoring rules require durable storage.', undefined, 503);
      const body = await readJson(request);
      const rule = validateMonitoringRule({ ...body, organizationId: principal.organizationId, createdBy: principal.userId });
      return json({ persistence: store.mode, rule: await store.saveRule(principal.organizationId, rule) }, 201);
    }
    if (url.pathname === '/v1/monitoring/deliveries' && request.method === 'GET') {
      authorize(principal, 'analytics:read');
      return json({ persistence: store.mode, deliveries: await store.listDeliveries(principal.organizationId, Number(url.searchParams.get('limit') ?? 50)) });
    }
    const preview = url.pathname.match(/^\/v1\/monitoring\/rules\/([^/]+)\/evaluate$/);
    if (preview && request.method === 'POST') {
      authorize(principal, 'analytics:read');
      const rule = (await store.listRules(principal.organizationId)).find((item) => item.id === decodeURIComponent(preview[1]));
      if (!rule) throw new MetricmindError('MONITORING_RULE_NOT_FOUND', 'Monitoring rule does not exist.', undefined, 404);
      const body = await readJson(request);
      return json({ evaluation: evaluateAlert(rule, body.observation ?? {}, { freshness: body.freshness, lastTriggeredAt: body.lastTriggeredAt, now: new Date() }) });
    }
    throw new MetricmindError('METHOD_NOT_ALLOWED', 'Monitoring endpoint method is not supported.', undefined, 405);
  } catch (error) {
    const response = asPublicError(error);
    return json(response.body, response.status);
  }
}

async function readJson(request) {
  if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) throw new MetricmindError('INVALID_CONTENT_TYPE', 'Use application/json.');
  try { return await request.json(); }
  catch { throw new MetricmindError('INVALID_JSON', 'The request body is not valid JSON.'); }
}
function json(body,status=200){return new Response(JSON.stringify(body,null,2),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
