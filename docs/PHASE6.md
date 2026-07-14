# Phase 6: Advanced analytics semantics

## Objective

Phase 6 adds governed measures, verified joins, ordered funnels, and matured cohort retention without introducing arbitrary SQL or hidden denominator rules.

## Measures

`POST /v1/advanced/measures/preview` supports structured `sum` and `average` definitions on the configured source. Currency measures require an explicitly normalized single-currency column and code.

`POST /v1/advanced/joined-measures/preview` accepts only organization-configured join paths with `verified` status and one-to-one or many-to-one cardinality. One-to-many paths are rejected to prevent silent row multiplication.

## Funnels

`POST /v1/advanced/funnels/preview` supports two to six ordered event steps with a 1-to-90-day conversion window. Every event value and period boundary is bound as a parameter. Results expose conversion from the first and previous step.

## Retention

`POST /v1/advanced/retention/preview` supports day, week, and month cohorts with 1-to-24 periods. Cohorts without a complete maturity window are excluded. Results expose cohort users, retained users, and the explicit rate for each period.

## Join governance

`POST /v1/advanced/join-paths/validate` validates an exact join path against `ANALYTICS_VERIFIED_JOIN_PATHS`, an environment JSON array. User-supplied join metadata cannot expand its own allowlist.

## Trust invariants

- all advanced queries are generated from structured definitions;
- all values and periods are parameterized;
- generated relations must be the configured source, exact verified join targets, or compiler-declared CTEs;
- system schemas, mutations, comments, and multiple statements remain blocked;
- funnels declare ordering and conversion windows;
- retention excludes immature cohorts;
- currency values are never silently combined;
- preview endpoints remain aggregate-only and read-only.

## Exit gate

Measures, verified many-to-one joins, ordered funnels, and matured retention compile deterministically, execute through the read-only adapter, return evidence, and pass the original SQL policy with explicit advanced allowlists.
