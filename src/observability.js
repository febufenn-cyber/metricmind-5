const SENSITIVE_KEY = /(authorization|token|secret|password|cookie|connection|string|email|phone|sql|parameters)/i;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+/gi;
const CREDENTIAL_URL = /([a-z]+:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

export function correlationId(request) {
  const supplied = request.headers.get('X-Correlation-ID');
  if (supplied && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}

export function redact(value, depth = 0) {
  if (depth > 8) return '[depth-limited]';
  if (typeof value === 'string') return value.replace(BEARER, 'Bearer [redacted]').replace(CREDENTIAL_URL, '$1[redacted]@').slice(0, 4000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1)]));
  }
  return value;
}

export async function emitLog(env, event) {
  const safe = redact({ ...event, timestamp: event.timestamp ?? new Date().toISOString() });
  if (typeof env.LOG_SINK?.write === 'function') {
    await env.LOG_SINK.write(safe);
    return;
  }
  if (env.LOG_LEVEL !== 'console') return;
  console.log(JSON.stringify(safe));
}

export function responseWithCorrelation(response, id) {
  const headers = new Headers(response.headers);
  headers.set('X-Correlation-ID', id);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function requestLog(request, response, id, startedAt) {
  const url = new URL(request.url);
  return {
    event: 'http_request', correlationId: id, method: request.method, path: url.pathname,
    status: response.status, durationMs: Date.now() - startedAt,
    userAgent: request.headers.get('User-Agent')?.slice(0, 200) ?? null
  };
}
