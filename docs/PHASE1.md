# Phase 1: Trust kernel

## Product boundary

Phase 1 answers aggregate descriptive questions over one allowlisted Postgres event table. It supports verified metric totals, complete-period comparisons, daily trends, segmentation, and ranking. It rejects causal, predictive, mutating, and personal-data requests.

## Trust invariants

1. Metric definitions are verified before use.
2. SQL comes from deterministic templates, not free-form model output.
3. Values are passed as bound parameters.
4. Only the configured schema and event table may be queried.
5. Execution uses a read-only Postgres transaction, statement timeout, and row cap.
6. A connection is rejected when the configured role can write to the event table.
7. Deterministic code calculates changes and percentages.
8. Answers expose metric definition, time boundaries, timezone, SQL, parameters, duration, assumptions, and data freshness.
9. RLS is enabled deny-by-default for application metadata.

## Phase 1B warehouse adapter

Cloudflare Workers connect through the `HYPERDRIVE` binding using `node-postgres` (`pg`). `ANALYTICS_DB` remains available as an injected adapter for tests and platform-specific integrations.

The concrete adapter:

- creates a client per request while Hyperdrive manages the underlying pool;
- opens `BEGIN TRANSACTION READ ONLY`;
- applies local statement and idle-transaction deadlines;
- returns aggregate rows only;
- classifies authentication, permission, timeout, connectivity, and schema errors;
- redacts database error messages from public responses;
- always rolls back and closes the logical client.

See [`PHASE1B.md`](PHASE1B.md) for provisioning, local development, credential rotation, and disconnect procedures.

## Canonical event mapping

The initial workspace expects:

- `event_name`
- `user_id`
- `occurred_at`
- optional `inserted_at`
- allowlisted dimensions: `platform`, `source`, `country`, `app_version`

The mapping can be overridden with Worker environment variables. Identifiers remain validated before use.

## API

- `GET /health`
- `GET /v1/metrics`
- `POST /v1/questions/interpret`
- `POST /v1/questions`
- `POST /v1/data-sources/test`
- `GET /v1/data-sources/schema`
- `GET /v1/data-sources/freshness`

Set `API_TOKEN` to require bearer authentication. Production should replace this bootstrap guard with verified Supabase JWTs and organization membership checks.

## Data-source checks

`POST /v1/data-sources/test` verifies the target table, `SELECT` permission, absence of table write privileges, and the active read-only transaction.

`GET /v1/data-sources/schema` returns column metadata, required-column mapping status, restricted-column warnings, and event-name counts from a bounded recent window. It does not return raw event rows. Invalid mappings are returned as diagnostics without attempting a query against missing columns.

`GET /v1/data-sources/freshness` returns the latest ingestion and event timestamps. The live question pipeline includes this evidence automatically.

## Known deliberate limitations

- Postgres only.
- One event table.
- Distinct-user event metrics only.
- No arbitrary SQL generation.
- No raw user export.
- No automatic root-cause claims.
- No frontend yet; the API response includes a constrained chart specification.
- Organization configuration is environment-backed rather than persisted.
- Supabase membership policies and encrypted per-organization configuration remain incomplete.

## Exit gate

Before calling all of Phase 1 production-ready:

- persist organization configuration without storing origin credentials in application tables;
- implement Supabase membership policies and JWT enforcement;
- expand golden questions to at least 50;
- add a larger adversarial Postgres corpus;
- validate timezone boundaries across DST and non-DST zones;
- add index and query-plan diagnostics for large warehouses.
