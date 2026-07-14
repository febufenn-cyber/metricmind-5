import apiWorker from './worker.js';
import { serveFrontend } from './frontend.js';

export default {
  async fetch(request, env = {}, context = {}) {
    const frontend = serveFrontend(request);
    if (frontend) return frontend;
    return apiWorker.fetch(request, env, context);
  },

  async scheduled(controller, env = {}, context = {}) {
    if (typeof apiWorker.scheduled === 'function') {
      return apiWorker.scheduled(controller, env, context);
    }
  }
};
