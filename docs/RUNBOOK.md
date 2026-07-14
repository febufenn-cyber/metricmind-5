# Metricmind production runbook

## First response

1. Record the incident start time and a correlation ID from an affected response.
2. Check `/health` for process liveness and `/ready` for configuration readiness.
3. Check Cloudflare errors, latency, request volume, rate limiting, scheduled runs, and provider delivery failures.
4. Avoid changing customer metric definitions during an availability incident unless semantic health is the confirmed issue.
5. Preserve logs and audit history. Never paste tokens, SQL parameters, or connection strings into tickets.

## Authentication or tenant-access failures

Symptoms: increased `401`, `403`, `ORGANIZATION_ACCESS_DENIED`, or readiness authentication failures.

Actions:

- Verify Supabase signing configuration, issuer, audience, and current keys.
- Confirm membership status and selected organization.
- Check clock skew and token expiry.
- Confirm bootstrap access remains disabled in production.
- Do not bypass membership checks. Roll back the Worker if a recent auth release caused the issue.

## Warehouse timeouts or query errors

Symptoms: `WAREHOUSE_QUERY_FAILED`, `WAREHOUSE_TIMEOUT`, rising duration, or empty answer volume.

Actions:

- Check Hyperdrive and origin database health.
- Verify the configured reader can still use a read-only transaction and has no write grants.
- Inspect only redacted query hashes and timing first; use protected evidence access for exact SQL.
- Reduce query range or disable affected advanced definitions if they exceed budget.
- Never grant write permission as a recovery action.

## Stale ingestion

Symptoms: freshness is `stale`, business alerts are suppressed, or investigations show reduced confidence.

Actions:

- Confirm the latest `inserted_at` and `occurred_at` timestamps.
- Check upstream event delivery and transformation jobs.
- Keep business alerts suppressed; use missing-data notifications only.
- After recovery, verify freshness and rerun affected scheduled windows only through a new idempotency key approved by an operator.

## Invalid semantic health

Symptoms: metric health is invalid, missing columns, broken dimensions, or ratio dependency failure.

Actions:

- Identify the exact active metric version and schema snapshot.
- Do not silently rewrite or reactivate definitions.
- Create a draft version, validate it, compare impact, obtain approval, and activate normally.
- Preserve historical answers with their original version hashes.

## Notification dead letters

Symptoms: `dead_letter` delivery state or provider errors.

Actions:

- Check destination verification and revocation status.
- Check provider quota and rate limits.
- Rotate provider credentials through environment management if compromised.
- Replay only the failed delivery with the original idempotency key policy; do not rerun the warehouse query unless evidence is missing.

## Alert storm

Symptoms: unexpected notification volume or repeated windows.

Actions:

- Disable the affected rule in durable monitoring storage.
- Check unique `(rule, window)` claims and cooldown configuration.
- Inspect scheduler clock and concurrent deployments.
- Preserve delivery records and contact recipients with a correction if necessary.

## Rate-limit incident

Symptoms: legitimate clients receive sustained `429` responses.

Actions:

- Check distributed limiter availability and tenant-level traffic.
- Confirm Retry-After behavior.
- Adjust quota only after identifying workload and abuse risk.
- Never disable rate limiting globally as the first action.

## Rollback

- Roll back the Worker to the previously verified version.
- Current migrations are additive; do not automatically reverse them during application rollback.
- Disable new rules or features through configuration if old code cannot interpret new records.
- Prefer forward-fix migrations for persisted data. Use database restoration only under the documented recovery procedure.

## Recovery confirmation

- `/health` returns 200.
- `/ready` returns 200 in the target environment.
- Authentication and cross-tenant negative checks pass.
- One verified question and one saved investigation complete.
- Freshness is healthy.
- A test notification is delivered to a non-customer destination.
- Error and latency indicators return to baseline.
- Incident notes contain correlation IDs and actions, not secrets.
