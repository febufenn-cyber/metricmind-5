# Phase 8: Production hardening and launch

## Objective

Phase 8 turns the implemented product into a release-gated V1 with explicit liveness, configuration readiness, observability, rate limits, repository security checks, migration checks, deployment procedures, and incident runbooks.

## Runtime controls

- `GET /health` is a dependency-free liveness endpoint.
- `GET /ready` evaluates required production bindings and returns `503` until identity, membership, durable metadata, warehouse, and distributed rate-limit services exist and bootstrap access is disabled.
- Every response receives an `X-Correlation-ID`.
- Structured request logs include method, path, status, duration, and correlation ID only. Sensitive keys, bearer values, credential URLs, SQL, and parameters are redacted.
- API routes are rate limited by a hash of organization, network address, and authorization material; raw identity material is never stored as the limiter key.

## Repository gates

`npm run validate` now performs:

1. JavaScript syntax validation;
2. credential and private-key scanning;
3. migration sequence, RLS, and destructive-operation checks;
4. the complete unit, API, security, and Postgres integration suite.

## Environment policy

A production environment is not ready while any of these remain missing:

- `AUTH_VERIFIER` or approved legacy JWT verifier configuration;
- membership storage;
- durable metadata stores;
- read-only warehouse binding;
- distributed rate limiter;
- removal of the bootstrap `API_TOKEN`.

A log sink is recommended but optional for readiness because some deployments may use platform-native logs.

## Launch truthfulness

Passing Phase 8 means the code and release gates are implemented and green. It does not prove that staging or production has been deployed. External launch requires real Cloudflare, Supabase, Hyperdrive, rate-limiter, log, and notification configuration plus a verified `/ready` response in that environment.

## Exit gate

The repository has automated security and migration gates, redacted observability, bounded API traffic, configuration readiness, load-oriented tests, deployment and rollback instructions, threat and incident documentation, and a repeatable launch checklist.
