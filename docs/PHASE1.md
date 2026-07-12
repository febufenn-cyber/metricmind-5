# Phase 1: Trust kernel

## Product boundary

Phase 1 answers aggregate descriptive questions over one allowlisted Postgres event table. It supports verified metric totals, complete-period comparisons, daily trends, segmentation, and ranking. It rejects causal, predictive, mutating, and personal-data requests.

## Trust invariants

1. Metric definitions are verified before use.
2. SQL comes from deterministic templates, not free-form model output.
3. Values are passed as bound parameters.
4. Only the configured schema and event table may be queried.
5. Execution uses a read-only adapter, statement timeout, and row cap.
6. Deterministic code calculates changes and percentages.
7. Answers expose metric definition, time boundaries, timezone, SQL, parameters, duration, and assumptions.
8. RLS is enabled deny-by-default for application metadata.

## Warehouse adapter contract

Bind `ANALYTICS_DB` to an object exposing:

```js
async query(sql, params, options) {
  // options.readOnly is always true
  // options.statementTimeoutMs bounds execution
  // options.maximumRows bounds result size
  return { rows: [] };
}
```

The adapter must use a dedicated Postgres role with only `CONNECT`, schema `USAGE`, and `SELECT` on specifically approved event tables. It must reject mutations independently of application validation.

## Canonical event mapping

The initial workspace expects:

- `event_name`
- `user_id`
- `occurred_at`
- optional `inserted_at`
- allowlisted dimensions: `platform`, `source`, `country`, `app_version`

Change the mapping in `src/config.js` or replace it with persisted organization configuration.

## API

- `GET /health`
- `GET /v1/metrics`
- `POST /v1/questions/interpret`
- `POST /v1/questions`
- `POST /v1/data-sources/test`

Set `API_TOKEN` to require bearer authentication. Production should replace this bootstrap guard with verified Supabase JWTs and organization membership checks.

## Known deliberate limitations

- Postgres only.
- One event table.
- Distinct-user event metrics only.
- No arbitrary SQL generation.
- No raw user export.
- No automatic root-cause claims.
- No frontend yet; the API response includes a constrained chart specification.
- Credential encryption and a concrete Postgres/Hyperdrive adapter depend on deployment infrastructure and are not faked in this repository.

## Exit gate

Before calling Phase 1 production-ready:

- implement a concrete read-only warehouse adapter;
- persist organization configuration and encrypted credentials;
- implement Supabase membership policies;
- expand golden questions to at least 50;
- run adversarial query tests against a disposable Postgres instance;
- validate timezone boundaries across DST and non-DST zones;
- add ingestion freshness queries and warnings to the live pipeline.
