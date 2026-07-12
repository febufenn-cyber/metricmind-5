# Metricmind

> Evidence-first product analytics for questions such as “How did signups change?”—without giving an AI unrestricted SQL access.

Metricmind Phase 1 is a working **trust kernel** for a narrow Postgres event model. It interprets supported descriptive questions, maps them to verified metrics, compiles parameterized SQL from deterministic templates, enforces a strict query policy, executes through a bounded read-only Postgres transaction, verifies result shape and arithmetic, and returns an auditable answer plus a constrained chart specification.

## What is implemented

- Postgres-only, one-table analytics boundary
- Concrete Cloudflare Hyperdrive adapter using `pg`
- Dedicated read-only transaction per operation
- Reader-role permission verification
- Schema discovery and canonical-column validation
- Live ingestion-freshness evidence
- Verified signup, activation, and purchase metrics
- Metric totals, complete-period comparisons, daily trends, segmentation, and ranking
- Organization timezone handling
- Parameterized SQL compiler
- Schema/table allowlist and read-only SQL policy
- Statement timeout and result cap
- Aggregate-only privacy boundary
- Evidence-first responses with SQL, parameters, metric definition, periods, assumptions, freshness, and execution metadata
- Cloudflare Worker-compatible HTTP API
- Supabase Phase 1 metadata schema with RLS enabled deny-by-default
- Unit, API, golden-question, and disposable-Postgres integration tests

## Deliberately not implemented yet

Metricmind does not claim root causes, predict outcomes, export personal data, write to the warehouse, accept arbitrary SQL, or store origin database credentials in Supabase. Organization membership, persisted per-tenant mappings, and the frontend remain later Phase 1 work.

## Validate

```bash
npm install
npm run validate
```

The real Postgres integration test runs automatically in CI. Locally, start the disposable reader database:

```bash
docker compose up -d postgres
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE='postgres://metricmind_reader:metricmind_local@127.0.0.1:55432/metricmind'
npx wrangler dev
```

## Connection verification

```bash
curl -X POST http://localhost:8787/v1/data-sources/test
curl http://localhost:8787/v1/data-sources/schema
curl http://localhost:8787/v1/data-sources/freshness
```

The connection endpoint fails unless the configured role can read the selected table, cannot write it, and is operating inside a read-only transaction.

## Example

```http
POST /v1/questions
Content-Type: application/json

{"question":"How did signups change last week?"}
```

The answer includes the exact metric definition, complete-period boundaries, timezone, freshness status, deterministic SQL, bound parameters, execution metadata, chart specification, and assumptions.

## Architecture

```text
Question
  → deterministic interpreter
  → verified metric resolution
  → complete-period planner
  → parameterized Postgres compiler
  → SQL safety policy
  → Hyperdrive + pg adapter
  → read-only transaction + deadlines
  → result verifier
  → deterministic arithmetic
  → evidence-first answer + chart spec
```

See [`docs/PHASE1.md`](docs/PHASE1.md) for product boundaries and [`docs/PHASE1B.md`](docs/PHASE1B.md) for reader-role and Hyperdrive operations.
