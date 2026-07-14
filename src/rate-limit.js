import { MetricmindError } from './errors.js';

const buckets = new Map();

export async function enforceRateLimit(request, env = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/v1/')) return null;
  const limit = positive(env.API_RATE_LIMIT_PER_MINUTE, 120);
  const key = await requestKey(request);
  const outcome = env.RATE_LIMITER?.limit
    ? await env.RATE_LIMITER.limit(key, { limit, windowSeconds: 60 })
    : memoryLimit(key, limit, Date.now());
  if (outcome.allowed !== false) return null;
  const retryAfter = Math.max(1, Number(outcome.retryAfterSeconds ?? 60));
  return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Request rate limit exceeded.' } }), {
    status: 429,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' }
  });
}

function memoryLimit(key, limit, now) {
  const windowStart = Math.floor(now / 60000) * 60000;
  const current = buckets.get(key);
  const bucket = !current || current.windowStart !== windowStart ? { windowStart, count: 0 } : current;
  bucket.count += 1;
  buckets.set(key, bucket);
  if (buckets.size > 10000) {
    for (const [itemKey, value] of buckets) if (value.windowStart < windowStart) buckets.delete(itemKey);
  }
  return { allowed: bucket.count <= limit, retryAfterSeconds: Math.ceil((windowStart + 60000 - now) / 1000) };
}

async function requestKey(request) {
  const authorization = request.headers.get('Authorization') ?? '';
  const organization = request.headers.get('X-Metricmind-Organization') ?? 'none';
  const address = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const data = new TextEncoder().encode(`${organization}|${address}|${authorization}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function positive(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) throw new MetricmindError('INVALID_RATE_LIMIT', 'API_RATE_LIMIT_PER_MINUTE must be 1 to 10000.', undefined, 500);
  return parsed;
}
