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
10. All semantic mutations are organization-scoped, revision-checked, authenticated, and auditable.

## Implemented model

- entities: user
- aggregations: distinct count, event count, ratio
- source boundary: one allowlisted Postgres event table
- predicates: equals, not equals, in, not in, is null, is not null
- dimensions: approved one-column dimensions
- reusable exclusion sets
- immutable versions with `restated` or `effective_dated` history policy
- deterministic semantic compiler and immutable answer lineage
- draft, review, validation, verification, and activation workflow
- optimistic semantic-store revisions
- live schema dependency health

Funnels, retention, arbitrary SQL, cross-warehouse metrics, automatic metric activation, and nested ratio dependencies remain outside this release.

## Semantic APIs

- `GET /v1/semantic/metrics`
- `GET /v1/semantic/metrics/{metricId}`
- `POST /v1/semantic/metrics/{metricId}/versions`
- `POST /v1/semantic/versions/{versionId}/submit`
- `POST /v1/semantic/versions/{versionId}/validate`
- `POST /v1/semantic/versions/{versionId}/verify`
- `POST /v1/semantic/versions/{versionId}/activate`
- `GET /v1/semantic/health`

Mutation endpoints require `API_TOKEN`, `X-Metricmind-Actor`, and a persistent `SEMANTIC_STORE` binding implementing `load(organizationId)` and `save(organizationId, catalog, { expectedRevision })`. The default seed store is read-only.

## Lifecycle

```text
draft
  → in_review
  → passed validation
  → verified
  → active
```

Activating a verified version supersedes the previous active version atomically. Verification is blocked unless the latest validation run passed. Store revisions prevent lost updates.

## Exit gate achieved

Production answers now reference active immutable semantic versions, unknown terms are refused, equal-strength aliases require clarification, version changes are auditable, and schema drift can mark affected metrics invalid without silently changing historical evidence.
