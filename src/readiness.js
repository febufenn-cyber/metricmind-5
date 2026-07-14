export function evaluateReadiness(env = {}) {
  const production = env.ENVIRONMENT === 'production';
  const checks = [
    check('authentication', Boolean(env.AUTH_VERIFIER || env.SUPABASE_JWT_SECRET), production),
    check('membership_store', Boolean(env.MEMBERSHIP_STORE || env.METADATA_DB), production),
    check('metadata_store', Boolean(env.METADATA_DB || (env.SEMANTIC_STORE && env.INVESTIGATION_STORE && env.MONITORING_STORE)), production),
    check('warehouse', Boolean(env.ANALYTICS_DB || env.HYPERDRIVE), true),
    check('rate_limiter', Boolean(env.RATE_LIMITER), production),
    check('log_sink', Boolean(env.LOG_SINK), false),
    check('bootstrap_disabled', !env.API_TOKEN, production)
  ];
  const failed = checks.filter((item) => item.required && item.status !== 'ready');
  return {
    status: failed.length ? 'not_ready' : 'ready',
    environment: production ? 'production' : env.ENVIRONMENT || 'development',
    checks,
    failedCheckIds: failed.map((item) => item.id)
  };
}

function check(id, ready, required) {
  return { id, status: ready ? 'ready' : required ? 'missing' : 'optional', required };
}
