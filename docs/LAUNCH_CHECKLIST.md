# Metricmind production launch checklist

## Release integrity

- [ ] Release SHA is on `main`.
- [ ] Required PR and CI checks are green.
- [ ] `npm ci --ignore-scripts` and `npm run validate` pass from the release SHA.
- [ ] Security and migration scanners pass.
- [ ] Release diff contains no credentials, temporary diagnostics, or weakened controls.

## Identity and tenancy

- [ ] Supabase JWT verification is configured with approved issuer and audience.
- [ ] Bootstrap `API_TOKEN` is absent from production.
- [ ] Active, suspended, expired, malformed, and cross-organization tests pass.
- [ ] Viewer, analyst, editor, approver, and administrator permissions are verified.
- [ ] RLS is enabled and negative tenant tests pass.

## Persistence and warehouse

- [ ] Metadata backup and recovery point are recorded.
- [ ] Migrations were tested on staging and applied in order.
- [ ] Semantic, investigation, and monitoring stores are durable.
- [ ] Hyperdrive or analytics binding uses the dedicated reader.
- [ ] Reader verification confirms no write privileges.
- [ ] Freshness and schema discovery are healthy.

## Product and analytics

- [ ] Onboarding, session, question, evidence, investigation, metric, and health views work.
- [ ] One total, comparison, trend, segmentation, advanced measure, funnel, and retention smoke test passes.
- [ ] Metric versions and definition hashes are visible.
- [ ] Invalid semantic health blocks or warns as documented.
- [ ] No output implies that association proves causation.

## Monitoring and notifications

- [ ] Distributed monitoring storage and hourly schedule are configured.
- [ ] Duplicate window claims are rejected.
- [ ] Stale ingestion suppresses business alerts.
- [ ] Verified test destinations deliver successfully.
- [ ] Retry and dead-letter history are visible.
- [ ] Customer destinations are enabled only after test confirmation.

## Reliability and security

- [ ] `/health` returns 200.
- [ ] `/ready` returns 200 with no failed required checks.
- [ ] Distributed rate limiter is configured and `429` includes Retry-After.
- [ ] Structured logs contain correlation IDs and no secrets.
- [ ] Error messages do not expose raw database or provider details.
- [ ] Threat model and runbook are reviewed by the launch owner.
- [ ] Backup, rollback, and incident contacts are current.

## Staging and production

- [ ] Staging deployed from the exact release SHA.
- [ ] Staging smoke, accessibility, and observation window passed.
- [ ] Production canary or limited cohort is defined.
- [ ] Previous verified Worker version is recorded for rollback.
- [ ] Production deployment evidence is recorded.
- [ ] Launch owner explicitly approves traffic expansion.

## Final status

- Release SHA:
- CI run:
- Migration range:
- Staging verification time:
- Production verification time:
- Rollback SHA:
- Launch owner:
- Residual risks:
