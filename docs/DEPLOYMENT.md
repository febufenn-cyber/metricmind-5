# Metricmind deployment and rollback

## Environments

Use separate Cloudflare, Supabase, Hyperdrive, metadata, rate-limit, log, and notification resources for development, staging, and production. Never reuse production origin credentials in CI or local development.

## Preflight

1. Review the release diff and merged PR checks.
2. Run `npm ci --ignore-scripts` and `npm run validate` from the exact release SHA.
3. Back up the Supabase metadata database and record its recovery point.
4. Review migrations in sequence and confirm they are additive or have a written compatibility plan.
5. Verify the customer warehouse reader has only the documented read privileges.
6. Verify all notification destinations with non-customer test channels.
7. Confirm the production environment does not define `API_TOKEN`.

## Required production bindings and secrets

- `AUTH_VERIFIER` or approved Supabase JWT verification configuration;
- `MEMBERSHIP_STORE` or `METADATA_DB`;
- durable semantic, investigation, and monitoring storage through `METADATA_DB` or explicit bindings;
- `HYPERDRIVE` or a production read-only analytics adapter;
- distributed `RATE_LIMITER`;
- `LOG_SINK` or approved platform-native structured logging;
- configured email, Slack, or webhook provider adapters only for enabled destinations.

Secrets must be supplied by the deployment platform. Do not place them in `wrangler.toml`, GitHub variables, source, logs, or database JSON.

## Migration procedure

1. Apply migrations to a restored staging copy.
2. Run migration and RLS checks.
3. Validate old application compatibility where a rolling deployment can overlap versions.
4. Apply production migrations in numeric order.
5. Verify RLS remains enabled and an unaffiliated authenticated user cannot read organization data.
6. Record migration completion, operator, and database recovery point.

Current repository migrations are designed to be additive. Do not assume future migrations are reversible.

## Staging deployment

1. Deploy the exact release SHA to staging.
2. Verify `/health` returns 200.
3. Verify `/ready` returns 200 and contains no missing required checks.
4. Test valid, expired, malformed, suspended-member, and cross-organization authentication cases.
5. Verify data-source permissions, freshness, one question, one investigation, one advanced preview, one monitoring rule, and one test delivery.
6. Run browser accessibility and responsive smoke checks.
7. Observe logs, errors, latency, warehouse timeouts, and limiter behavior.

## Production deployment

1. Use a limited cohort or canary route where available.
2. Deploy the exact staging-verified SHA.
3. Repeat liveness and readiness checks.
4. Execute only synthetic or approved production smoke tests.
5. Monitor errors, latency, authentication failures, warehouse duration, schedule duplication, notification dead letters, and rate limiting.
6. Expand traffic only after the observation window passes.

## Application rollback

1. Stop traffic expansion and disable affected monitoring rules if necessary.
2. Redeploy the previously verified Worker version.
3. Do not automatically reverse additive database migrations.
4. Verify the previous application can safely ignore new records and columns.
5. If incompatible persisted data exists, use a reviewed forward-fix or feature disablement.
6. Confirm `/health`, `/ready`, tenant isolation, warehouse reads, and scheduler idempotency.

## Database recovery

Database restoration is a last resort for corruption or destructive operator error. Pause metadata mutations and scheduled jobs, capture current state, restore to a separate instance, validate organization counts and audit history, then switch using a reviewed incident procedure. Never restore the customer analytics warehouse as part of a Metricmind application rollback.

## Deployment evidence

Record release SHA, PRs, CI run, migration set, staging verification, production verification, operator, start/end time, readiness response, rollback version, and any known residual risk.
