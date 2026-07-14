import { MetricmindError } from './errors.js';
import { ORGANIZATION_ROLES } from './authorization.js';

const encoder = new TextEncoder();

export async function authenticateRequest(request, env = {}, options = {}) {
  if (options.public === true) return null;
  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : null;

  if (env.API_TOKEN && token === env.API_TOKEN) return bootstrapPrincipal(request, env);

  const authConfigured = Boolean(env.AUTH_VERIFIER || env.SUPABASE_JWT_SECRET || env.SUPABASE_JWT_ISSUER);
  if (!authConfigured) {
    if (env.API_TOKEN) throw unauthorized();
    return developmentPrincipal(request, env);
  }
  if (!token) throw unauthorized();

  const claims = env.AUTH_VERIFIER
    ? await verifyWithBinding(env.AUTH_VERIFIER, token)
    : await verifyHs256Jwt(token, env);
  return principalFromClaims(request, env, claims);
}

async function verifyWithBinding(binding, token) {
  if (typeof binding?.verify !== 'function') {
    throw new MetricmindError('INVALID_AUTH_VERIFIER', 'AUTH_VERIFIER must implement verify(token).', undefined, 500);
  }
  let claims;
  try {
    claims = await binding.verify(token);
  } catch {
    throw unauthorized();
  }
  validateRegisteredClaims(claims, {});
  return claims;
}

export async function verifyHs256Jwt(token, env = {}, now = new Date()) {
  if (!env.SUPABASE_JWT_SECRET) {
    throw new MetricmindError(
      'AUTH_VERIFIER_NOT_CONFIGURED',
      'Configure AUTH_VERIFIER for asymmetric signing keys or SUPABASE_JWT_SECRET for legacy HS256 tokens.',
      undefined,
      500
    );
  }
  const parts = String(token).split('.');
  if (parts.length !== 3) throw unauthorized();
  let header;
  let claims;
  let signature;
  try {
    header = JSON.parse(decodeBase64Url(parts[0]));
    claims = JSON.parse(decodeBase64Url(parts[1]));
    signature = decodeBase64UrlBytes(parts[2]);
  } catch {
    throw unauthorized();
  }
  if (header.alg !== 'HS256' || (header.typ && header.typ !== 'JWT')) throw unauthorized();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.SUPABASE_JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    encoder.encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw unauthorized();
  validateRegisteredClaims(claims, {
    issuer: env.SUPABASE_JWT_ISSUER,
    audience: env.SUPABASE_JWT_AUDIENCE,
    now
  });
  return claims;
}

function validateRegisteredClaims(claims, { issuer, audience, now = new Date() }) {
  if (!claims || typeof claims !== 'object' || typeof claims.sub !== 'string' || claims.sub.length < 2) throw unauthorized();
  const timestamp = Math.floor(now.getTime() / 1000);
  const skew = 30;
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) < timestamp - skew) throw unauthorized();
  if (claims.nbf !== undefined && Number(claims.nbf) > timestamp + skew) throw unauthorized();
  if (issuer && claims.iss !== issuer) throw unauthorized();
  if (audience) {
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(audience)) throw unauthorized();
  }
}

async function principalFromClaims(request, env, claims) {
  const organizationId = selectedOrganization(request, claims);
  if (!organizationId) {
    throw new MetricmindError('ORGANIZATION_REQUIRED', 'Select an organization with X-Metricmind-Organization.', undefined, 400);
  }
  const membership = await resolveMembership(env, claims.sub, organizationId, claims);
  if (!membership || membership.status !== 'active' || !ORGANIZATION_ROLES.includes(membership.role)) {
    throw new MetricmindError('ORGANIZATION_ACCESS_DENIED', 'You are not an active member of this organization.', undefined, 403);
  }
  return {
    userId: claims.sub,
    organizationId,
    role: membership.role,
    email: typeof claims.email === 'string' ? claims.email : null,
    authenticationMode: 'supabase_jwt',
    claims
  };
}

async function resolveMembership(env, userId, organizationId, claims) {
  if (env.MEMBERSHIP_STORE) {
    if (typeof env.MEMBERSHIP_STORE.getMembership !== 'function') {
      throw new MetricmindError('INVALID_MEMBERSHIP_STORE', 'MEMBERSHIP_STORE must implement getMembership(userId, organizationId).', undefined, 500);
    }
    return env.MEMBERSHIP_STORE.getMembership(userId, organizationId);
  }
  if (env.METADATA_DB?.query) {
    const result = await env.METADATA_DB.query(
      'SELECT role, status FROM public.organization_memberships WHERE user_id = $1::uuid AND organization_id = $2::uuid LIMIT 1',
      [userId, organizationId],
      { readOnly: true, statementTimeoutMs: 3000, maximumRows: 1 }
    );
    return result?.rows?.[0] ?? null;
  }
  const organizations = claims.app_metadata?.organizations;
  const embedded = organizations && typeof organizations === 'object' ? organizations[organizationId] : null;
  if (embedded) return { role: typeof embedded === 'string' ? embedded : embedded.role, status: 'active' };
  throw new MetricmindError('MEMBERSHIP_STORE_NOT_CONFIGURED', 'Production JWT authentication requires organization membership storage.', undefined, 503);
}

function selectedOrganization(request, claims) {
  return request.headers.get('X-Metricmind-Organization')
    ?? claims.organization_id
    ?? claims.app_metadata?.default_organization_id
    ?? null;
}

function bootstrapPrincipal(request, env) {
  return {
    userId: request.headers.get('X-Metricmind-Actor') || 'bootstrap-admin',
    organizationId: request.headers.get('X-Metricmind-Organization') || env.ORGANIZATION_ID || 'demo-org',
    role: 'organization_admin',
    email: null,
    authenticationMode: 'bootstrap_token',
    claims: null
  };
}

function developmentPrincipal(request, env) {
  return {
    userId: request.headers.get('X-Metricmind-Actor') || 'local-development',
    organizationId: request.headers.get('X-Metricmind-Organization') || env.ORGANIZATION_ID || 'demo-org',
    role: 'organization_admin',
    email: null,
    authenticationMode: 'development_unverified',
    claims: null
  };
}

function unauthorized() {
  return new MetricmindError('UNAUTHORIZED', 'A valid bearer token is required.', undefined, 401);
}

function decodeBase64Url(value) {
  return new TextDecoder().decode(decodeBase64UrlBytes(value));
}

function decodeBase64UrlBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
