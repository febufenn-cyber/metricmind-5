import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateRequest, verifyHs256Jwt } from '../src/auth.js';
import { authorize } from '../src/authorization.js';

const secret = 'phase-four-test-secret-at-least-32-bytes';

async function token(claims) {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode(claims);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

function encode(value) { return base64url(new TextEncoder().encode(JSON.stringify(value))); }
function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

test('HS256 verifier validates signature, issuer, audience, and expiry', async () => {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await token({ sub: '11111111-1111-1111-1111-111111111111', exp: now + 300, iss: 'https://example.supabase.co/auth/v1', aud: 'authenticated' });
  const claims = await verifyHs256Jwt(jwt, {
    SUPABASE_JWT_SECRET: secret,
    SUPABASE_JWT_ISSUER: 'https://example.supabase.co/auth/v1',
    SUPABASE_JWT_AUDIENCE: 'authenticated'
  });
  assert.equal(claims.aud, 'authenticated');
  await assert.rejects(() => verifyHs256Jwt(`${jwt}broken`, { SUPABASE_JWT_SECRET: secret }), (error) => error.code === 'UNAUTHORIZED');
});

test('authentication selects organization only after active membership', async () => {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await token({ sub: '11111111-1111-1111-1111-111111111111', exp: now + 300 });
  const request = new Request('https://metricmind.test/v1/metrics', {
    headers: { Authorization: `Bearer ${jwt}`, 'X-Metricmind-Organization': '22222222-2222-2222-2222-222222222222' }
  });
  const principal = await authenticateRequest(request, {
    SUPABASE_JWT_SECRET: secret,
    MEMBERSHIP_STORE: { async getMembership() { return { role: 'analyst', status: 'active' }; } }
  });
  assert.equal(principal.organizationId, '22222222-2222-2222-2222-222222222222');
  assert.equal(principal.role, 'analyst');
});

test('role permissions separate semantic editing and approval', () => {
  const editor = { userId: 'u', organizationId: 'o', role: 'metric_editor' };
  authorize(editor, 'semantic:edit');
  assert.throws(() => authorize(editor, 'semantic:approve'), (error) => error.code === 'FORBIDDEN');
  const approver = { userId: 'u2', organizationId: 'o', role: 'metric_approver' };
  authorize(approver, 'semantic:approve');
  assert.throws(() => authorize(approver, 'semantic:edit'), (error) => error.code === 'FORBIDDEN');
});
