# Metricmind

> Evidence-first product analytics for questions such as “How did signups change?”—without giving an AI unrestricted SQL access.

Metricmind Phase 1 is a working **trust kernel** for a narrow Postgres event model. It interprets supported descriptive questions, maps them to verified metrics, compiles parameterized SQL from deterministic templates, enforces a strict query policy, verifies result shape and arithmetic, and returns an auditable answer plus a constrained chart specification.

## What is implemented

- Postgres-only, one-table analytics boundary
- Verified signup, activation, and purchase metrics
- Metric totals, complete-period comparisons, daily trends, segmentation, and ranking
- Organization timezone handling
- Parameterized SQL compiler
- Schema/table allowlist and read-only SQL policy
- Statement timeout and result-cap adapter contract
- Aggregate-only privacy boundary
- Evidence-first responses with SQL, parameters, metric definition, periods, assumptions, and execution metadata
- Cloudflare Worker-compatible HTTP API
- Supabase Phase 1 metadata schema with RLS enabled deny-by-default
- Node test suite and starter golden evaluation set

## Deliberately not implemented yet

Metricmind does not claim root causes, predict outcomes, export personal data, write to the warehouse, accept arbitrary SQL, or pretend that credentials and Supabase membership are secure before deployment-specific adapters and policies exist.

## Run locally

```bash
npm run validate
```

The core has no runtime package dependencies. To execute live questions, bind `ANALYTICS_DB` to a read-only Postgres adapter following the contract in [`docs/PHASE1.md`](docs/PHASE1.md).

## Example

```http
POST /v1/questions/interpret
Content-Type: application/json

{"question":"How did signups change last week?"}
```

The interpretation is converted into a complete-period plan in the organization timezone. Live execution through `POST /v1/questions` requires the warehouse binding.

## Architecture

```text
Question
  → deterministic interpreter
  → verified metric resolution
  → complete-period planner
  → parameterized Postgres compiler
  → SQL safety policy
  → read-only warehouse adapter
  → result verifier
  → deterministic arithmetic
  → evidence-first answer + chart spec
```

See [`docs/PHASE1.md`](docs/PHASE1.md) for boundaries, deployment requirements, and the remaining production exit gate.
