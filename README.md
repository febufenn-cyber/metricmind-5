# Metricmind

> Evidence-first product analytics without unrestricted AI-generated SQL.

Metricmind is a Cloudflare Worker application for authenticated, multi-tenant product analytics over a read-only Postgres warehouse. It combines deterministic query compilation, immutable metric definitions, bounded investigations, advanced analytics, scheduled alerts, and visible evidence.

## Production V1 capabilities

### Trusted warehouse access

- Cloudflare Hyperdrive and `pg` reader adapter;
- dedicated read-only transactions, permission verification, statement deadlines, range and row caps;
- schema discovery, freshness evidence, aggregate-only privacy boundary, and strict table/relation allowlists.

### Semantic memory

- organization-scoped entities, dimensions, exclusions, aliases, and immutable metric versions;
- draft, validation, review, verification, activation, supersession, health, audit, and optimistic revisions;
- distinct count, event count, ratio, sum, average, normalized-currency measures, and configured safe joins.

### Questions and investigations

- totals, complete-period comparisons, trends, segmentation, ranking, funnels, and matured cohort retention;
- evidence-bounded “why” investigations with observations, hypotheses, contradictions, confidence, SQL evidence, and `causalStatus: not_established`;
- append-only accepted, rejected, or inconclusive human reviews.

### Product and operations

- responsive accessible frontend served by the Worker;
- verified Supabase identity, organization roles, durable metadata adapters, and RLS migrations;
- scheduled threshold, percentage-change, missing-data, and deterministic anomaly alerts;
- stale-data suppression, idempotency, cooldowns, verified notification destinations, bounded retries, and dead letters;
- liveness, production readiness, correlation IDs, redacted logs, rate limits, security scanning, migration checks, and operational runbooks.

## Run locally

```bash
npm ci --ignore-scripts
docker compose up -d postgres
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE='postgres://metricmind_reader:metricmind_local@127.0.0.1:55432/metricmind'
npx wrangler dev
```

Open the local Worker URL in a browser. The local database credentials above are fixture-only and must never be used outside local development.

## Validate

```bash
npm run validate
```

Validation includes syntax checks, credential scanning, migration/RLS checks, unit and API tests, and disposable-Postgres integration tests.

## Runtime checks

```bash
curl http://localhost:8787/health
curl http://localhost:8787/ready
```

`/health` reports process liveness. In production, `/ready` returns `503` until verified identity, membership, durable metadata, a read-only warehouse, a distributed rate limiter, and bootstrap-token removal are configured.

## Architecture

```text
Browser application
  → verified user and organization
  → role authorization and tenant persistence
  → immutable semantic metric version
  → deterministic analysis or bounded investigation plan
  → parameterized SQL safety policy
  → Hyperdrive read-only transaction
  → verified arithmetic and evidence
  → optional idempotent monitoring and verified notification delivery
```

## Important boundaries

Metricmind does not accept arbitrary SQL, export raw personal data, write to the customer warehouse, establish causation, forecast outcomes, or take autonomous remediation actions. Provider credentials and origin database passwords are environment-managed and are not stored in application records.

The repository implements the production-V1 code and release gates. It does **not** prove that a real staging or production environment has been configured or deployed. Follow the launch checklist and verify `/ready` externally before claiming deployment.

## Documentation

- [Phase 1 trust kernel](docs/PHASE1.md)
- [Phase 1B Postgres operations](docs/PHASE1B.md)
- [Phase 2 semantic memory](docs/PHASE2.md)
- [Phase 3 investigations](docs/PHASE3.md)
- [Phase 4 identity and tenancy](docs/PHASE4.md)
- [Phase 5 frontend](docs/PHASE5.md)
- [Phase 6 advanced analytics](docs/PHASE6.md)
- [Phase 7 monitoring](docs/PHASE7.md)
- [Phase 8 production hardening](docs/PHASE8.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Deployment and rollback](docs/DEPLOYMENT.md)
- [Incident runbook](docs/RUNBOOK.md)
- [Launch checklist](docs/LAUNCH_CHECKLIST.md)
