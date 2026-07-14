import apiWorker from './worker.js';
import { serveFrontend } from './frontend.js';
import { handleAdvancedRequest } from './advanced-routes.js';
import { handleMonitoringRequest } from './monitoring-routes.js';
import { runMonitoringSchedules } from './monitoring-runner.js';
import { correlationId, emitLog, requestLog, responseWithCorrelation } from './observability.js';
import { enforceRateLimit } from './rate-limit.js';
import { evaluateReadiness } from './readiness.js';

export default {
  async fetch(request, env = {}, context = {}) {
    const id = correlationId(request);
    const startedAt = Date.now();
    let response;
    const path = new URL(request.url).pathname;
    if (path === '/health') {
      response = json({ status: 'ok', phase: '8-production-v1' });
    } else if (path === '/ready') {
      const readiness = evaluateReadiness(env);
      response = json(readiness, readiness.status === 'ready' ? 200 : 503);
    } else {
      const limited = await enforceRateLimit(request, env);
      if (limited) response = limited;
      else {
        const frontend = serveFrontend(request);
        if (frontend) response = frontend;
        else {
          const advanced = await handleAdvancedRequest(request, env);
          if (advanced) response = advanced;
          else {
            const monitoring = await handleMonitoringRequest(request, env);
            response = monitoring ?? await apiWorker.fetch(request, env, context);
          }
        }
      }
    }
    const finalResponse = responseWithCorrelation(response, id);
    const logging = emitLog(env, requestLog(request, finalResponse, id, startedAt));
    if (typeof context.waitUntil === 'function') context.waitUntil(logging);
    else await logging;
    return finalResponse;
  },

  async scheduled(controller, env = {}, context = {}) {
    const startedAt = Date.now();
    const execution = runMonitoringSchedules(env, new Date(controller.scheduledTime ?? Date.now()));
    const observed = execution.then((result) => emitLog(env, {
      event: 'scheduled_monitoring', status: result.status, processed: result.processed,
      durationMs: Date.now() - startedAt
    }));
    if (typeof context.waitUntil === 'function') {
      context.waitUntil(execution);
      context.waitUntil(observed);
    }
    return execution;
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
