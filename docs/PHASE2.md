# Phase 2: Semantic memory

Phase 2 replaces hard-coded metric meaning with an organization-scoped, versioned semantic catalog.

## Product promise

Define a business metric once, verify the exact entity, aggregation, filters, exclusions, time policy, and approved dimensions, then reuse the same immutable version in every analytical answer.

## Trust invariants

1. Stable metric identity is separate from immutable metric versions.
2. Only one active version may serve production questions for a metric.
3. Draft, review, verification, activation, supersession, and deprecation are explicit states.
4. Verified versions are never edited in place; changes create a new draft version.
5. Every answer records the metric ID, version ID, version number, and definition hash.
6. Aliases belong to the stable metric identity and ambiguity is surfaced rather than guessed.
7. Entity, aggregation, timestamp, predicates, exclusions, and dimension permissions remain structured data.
8. Metric definitions compile through deterministic code and still pass the Phase 1 SQL safety kernel.
9. Schema drift can mark a metric unhealthy, but never silently rewrites its meaning.
10. All semantic mutations are organization-scoped and auditable.

## Initial supported model

- entities: user
- aggregations: distinct count, event count, ratio
- source boundary: one allowlisted Postgres event table
- predicates: equals, not equals, in, not in, is null, is not null
- dimensions: approved one-column dimensions
- reusable exclusion sets
- immutable versions with `restated` or `effective_dated` history policy

Funnels, retention, arbitrary SQL, cross-warehouse metrics, and automatic metric activation remain outside this first Phase 2 release.

## Delivery slices

### Phase 2A — catalog foundation

- semantic migration and RLS boundary
- entities, dimensions, exclusions, stable metrics, aliases, immutable versions
- lifecycle validation and active-version invariants

### Phase 2B — semantic compiler

- resolve aliases to active versions
- compile structured metric definitions into deterministic SQL
- attach semantic lineage to evidence
- reject unknown and ambiguous concepts

### Phase 2C — verification and health

- preview and validation checks
- verify and activate lifecycle
- schema dependency health
- metric impact and review endpoints

## Exit gate

Phase 2 is complete when all production answers reference an active immutable semantic version, unknown terms are refused, ambiguous aliases require clarification, version changes are auditable, and schema drift can invalidate affected metrics without silently changing historical evidence.
