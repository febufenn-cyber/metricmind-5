import apiWorker from './worker.js';
import { serveFrontend } from './frontend.js';
import { handleAdvancedRequest } from './advanced-routes.js';
import { handleMonitoringRequest } from './monitoring-routes.js';
import { runMonitoringSchedules } from './monitoring-runner.js';

export default {
  async fetch(request, env = {}, context = {}) {
    const frontend = serveFrontend(request);
    if (frontend) return frontend;
    const advanced = await handleAdvancedRequest(request, env);
    if (advanced) return advanced;
    const monitoring = await handleMonitoringRequest(request, env);
    if (monitoring) return monitoring;
    return apiWorker.fetch(request, env, context);
  },

  async scheduled(controller, env = {}, context = {}) {
    const execution = runMonitoringSchedules(env, new Date(controller.scheduledTime ?? Date.now()));
    if (typeof context.waitUntil === 'function') context.waitUntil(execution);
    return execution;
  }
};
