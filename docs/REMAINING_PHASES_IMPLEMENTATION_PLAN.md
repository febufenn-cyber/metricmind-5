# Metricmind Remaining Phases Implementation and Autonomous Execution Plan

**Plan version:** 1.0  
**Prepared:** 14 July 2026  
**Repository:** `febufenn-cyber/metricmind-5`  
**Verified baseline:** `main` at `1f894efa38d00babe5917e21ddb04d22ba115d27`  
**Trigger command:** `build`

## 1. Decision: how many phases remain?

Metricmind needs **five more core phases** to reach a production-ready V1:

| Phase | Name | Primary outcome |
|---|---|---|
| 4 | Production Identity, Tenancy and Durable Stores | Secure multi-tenant persistence and role enforcement |
| 5 | Product Frontend and Onboarding | A complete user-facing application |
| 6 | Advanced Analytics Semantics | Funnels, cohorts, retention, measures and verified joins |
| 7 | Monitoring, Alerts and Scheduled Briefs | Continuous metric monitoring and controlled notifications |
| 8 | Production Hardening and Launch | An operable, secure, observable and deployable V1 |

Phases 1-3 already establish the trust kernel, semantic memory and evidence-bounded investigation engine. Optional post-V1 work may continue as Phase 9+, but it is not required for the first production release.

## 2. Current verified baseline

The roadmap assumes these capabilities are already on `main`:

- read-only, parameterized Postgres analytics through Hyperdrive;
- schema discovery, freshness checks and reader-role verification;
- immutable semantic metric versions, validation, activation and health;
- descriptive questions, trends, comparisons, segmentation and ranking;
- evidence-bounded investigations with non-causal hypotheses;
- investigation storage contracts, reviews and append-only conclusions;
- CI with Node validation and disposable Postgres integration tests.

Before any phase begins, the implementation agent must verify this baseline against the live repository rather than trusting this document blindly.

## 3. Autonomous execution contract

When the user sends the exact command **`build`**, the implementation agent is authorized to execute Phases 4-8 sequentially in one continuous run, subject to the safety and merge gates below.

### 3.1 Required pre-phase verification

Before implementing each phase, the agent must:

1. Fetch the latest `main` head and confirm the repository and default branch.
2. Read this roadmap and existing `docs/PHASE*.md` files from `main`.
3. Inspect current source files, migrations, package scripts, CI workflow and open pull requests.
4. Compare the phase plan with what is already implemented.
5. Produce an internal verification record with baseline SHA, existing capabilities, gaps, implementation slices, migration risks and required tests.
6. Reconcile partial or conflicting work instead of duplicating it.
7. Continue without routine clarification questions. Missing credentials may block deployment, but must not block safe implementation, adapters, migrations, tests or documentation.

### 3.2 Required implementation loop

For every slice:

1. Create `agent/phase-<number><slice>-<description>` from the current `main`.
2. Implement only the declared scope.
3. Add or update unit, API, security and integration tests.
4. Update phase documentation and migration notes.
5. Run the strongest available local validation.
6. Commit concisely and push the branch.
7. Open a PR against `main` with scope, rationale, safety decisions and validation.
8. Wait for GitHub Actions.
9. On failure, inspect exact logs, fix the root cause and rerun the full workflow.
10. Review the final diff for accidental scope expansion, secret leakage, weakened controls and migration hazards.
11. Merge only when checks pass and the PR is mergeable.
12. Verify the merged PR, merge SHA and new `main` head.
13. Confirm the completed slice before starting the next one.

### 3.3 Non-negotiable merge rules

- Never force-push `main`.
- Never merge failing or missing required checks.
- Never bypass branch protection or weaken trust controls to make CI pass.
- Never commit credentials, access tokens or origin database passwords.
- Never claim deployment unless the external deployment was verified.
- Prefer a clean squash merge for each coherent slice.
- Every completed phase must be present on `main`, not merely in an open PR.

### 3.4 Required confirmation after each phase

Report:

- phase and slices completed;
- PR numbers and titles;
- merge commit SHAs;
- final `main` head;
- CI run result and test summary;
- migrations added;
- security invariants verified;
- deployment actions completed or credentials still required;
- remaining blockers without presenting them as completed work.

## Phase 4 - Production Identity, Tenancy and Durable Stores

**Objective:** Replace bootstrap tokens and in-process storage with authenticated, organization-scoped and durable production infrastructure.

### Planned slices

#### 4A - Supabase authentication and membership

- Validate Supabase JWT issuer, audience, expiry and signature in the Worker.
- Derive actor identity from the validated token in production.
- Add viewer, analyst, metric editor, metric approver and organization administrator roles.
- Add role-aware authorization and negative-path tests.

#### 4B - Durable semantic and investigation stores

- Implement concrete Supabase-backed semantic and investigation stores.
- Preserve optimistic revisions, immutable versions and append-only reviews.
- Use transactional writes for lifecycle transitions that change several records.
- Remove production reliance on seed and in-process stores.

#### 4C - Tenant mappings and RLS

- Persist safe per-organization warehouse mappings and Hyperdrive references.
- Add RLS membership policies across all organization-owned records.
- Test cross-organization denial at application and database layers.

#### 4D - Audit and recovery hardening

- Add correlation IDs and actor/organization audit context.
- Add store health, migration, concurrency, expiry, revocation and recovery tests.

### Trust invariants

- A user cannot read or mutate another organization.
- Metric editors cannot approve their own changes unless policy explicitly permits it.
- Warehouse origin credentials never enter Supabase application tables.
- Production mutations require durable storage.
- Authentication failures fail closed.

### Exit gate

All production reads and writes are authenticated, tenant-scoped, role-authorized, RLS-protected and durable. No production path depends on actor headers, seed stores or ephemeral process memory.

## Phase 5 - Product Frontend and Onboarding

**Objective:** Deliver a complete, accessible product experience around the trusted backend.

### Planned slices

#### 5A - Application shell and design system

- Build a TypeScript React application suitable for Cloudflare deployment.
- Create responsive navigation, accessible components, loading states, error boundaries and a typed API client.

#### 5B - Organization onboarding and data-source connection

- Organization creation, member invitation and data-source connection wizard.
- Reader-role verification, schema mapping, freshness status and disconnect workflow.

#### 5C - Ask and investigate experience

- Natural-language question interface with constrained chart rendering.
- Evidence drawer showing metric version, periods, SQL, parameters, freshness and execution metadata.
- Investigation workspace with observations, hypotheses, contradictions, confidence and review history.

#### 5D - Semantic governance interface

- Metric catalog, structured editor, preview, validation, impact comparison and activation.
- Semantic-health dashboard and schema-drift warnings.

### Trust invariants

- Causal status and uncertainty remain visible.
- Evidence is never hidden behind an unlabelled summary.
- Governance-changing actions require explicit confirmation.
- Errors do not leak secrets or raw database messages.
- Keyboard navigation, contrast and semantic structure are accessible.

### Exit gate

A new organization can sign in, connect a read-only warehouse, verify a metric, ask a question, inspect evidence, run an investigation and review a semantic change without command-line or direct database access.

## Phase 6 - Advanced Analytics Semantics

**Objective:** Extend the safe semantic model beyond one-table count metrics while preserving deterministic compilation and reproducibility.

### Planned slices

#### 6A - Verified measures and join paths

- Add sum and average measures.
- Add approved one-to-one and many-to-one join paths.
- Validate cardinality, detect row multiplication and expose query-cost diagnostics.
- Support normalized single-currency revenue measures.

#### 6B - Funnels

- Structured funnel definitions with entity, ordered steps, conversion window, re-entry and maturity rules.
- Deterministic funnel SQL and eligible-denominator evidence.

#### 6C - Cohorts and retention

- Daily, weekly and monthly cohort matrices.
- Explicit denominators, surviving populations and incomplete-window handling.

#### 6D - Advanced investigations

- Funnel-step and retention-cohort investigations.
- Ratio segmentation only where mathematically valid.
- Verified join-path lineage in every evidence block.

### Trust invariants

- No arbitrary joins.
- No hidden denominator or cohort-maturity rules.
- No one-to-many multiplication without deterministic protection.
- Multi-currency values are never silently combined.
- Every query still passes the Phase 1 SQL safety boundary.

### Exit gate

Verified measures, funnels and retention can be defined, validated, queried and investigated with reproducible lineage, bounded cost and explicit maturity rules.

## Phase 7 - Monitoring, Alerts and Scheduled Briefs

**Objective:** Turn trusted analytics into continuous monitoring without autonomous remediation.

### Planned slices

#### 7A - Saved analyses and schedules

- Save questions and investigation templates.
- Add organization-timezone schedules, idempotency keys and bounded retries.

#### 7B - Alert rules and anomaly detection

- Threshold, percentage-change and missing-data alerts.
- Documented deterministic anomaly baselines and seasonality assumptions.
- Cooldown, deduplication, suppression and acknowledgement states.

#### 7C - Notification adapters

- Email, Slack and generic webhook adapters.
- Verified destinations, least-privilege secrets, delivery audit, retry and dead-letter handling.

#### 7D - Daily and weekly briefs

- Evidence-linked movements, active warnings, investigations and semantic health.
- No unsupported causal claims or hidden model-generated values.

### Trust invariants

- Alerts never write to the customer warehouse.
- Notification delivery never implies causal certainty.
- Duplicate executions do not produce repeated alerts.
- Stale data is identified before a business alert is sent.
- Failed deliveries are observable and retry-bounded.

### Exit gate

Organizations can configure schedules and alerts, receive reproducible evidence-linked notifications, acknowledge them and inspect complete execution and delivery history.

## Phase 8 - Production Hardening and Launch

**Objective:** Make Metricmind secure, observable, supportable and safely deployable.

### Planned slices

#### 8A - Observability and reliability

- Structured logs, correlation IDs, traces and redacted error reporting.
- Service-level indicators, runbooks, health dashboards, timeouts, retries and circuit breakers.

#### 8B - Security and privacy

- Formal threat model and abuse cases.
- Dependency, secret and migration scanning.
- Rate limits, quotas, retention, deletion and offboarding workflows.
- Security review of JWT, RLS, Hyperdrive, notification secrets and audit logs.

#### 8C - Performance and cost controls

- Load tests and large-table benchmarks.
- Query budgets, explain-plan diagnostics and cache policy.
- Job concurrency controls, usage metering and quota enforcement.

#### 8D - Deployment and release engineering

- Development, staging and production environments.
- Migration preflight, rollback and recovery instructions.
- Backup/restore rehearsal and canary or limited-cohort launch.

#### 8E - Evaluation, documentation and launch gate

- Expanded golden, adversarial and red-team corpora.
- End-to-end browser tests and accessibility audit.
- Admin, customer, support and incident documentation.

### Trust invariants

- No production promotion without passing required checks.
- Secrets are environment-managed and rotatable.
- Migrations have preflight and rollback procedures.
- Operational dashboards do not expose sensitive payloads.
- Deployment claims require external verification.

### Exit gate

Metricmind deploys through a repeatable pipeline, survives load and failure tests, enforces tenant isolation, exposes operational health and has documented backup, rollback and support procedures.

## 9. Definition of production-ready V1

The V1 is complete only when:

- authenticated multi-tenant persistence is operational;
- a user-facing application supports onboarding through investigation review;
- advanced semantic analytics have explicit denominator, join and maturity rules;
- schedules and alerts are reproducible, observable and non-autonomous;
- production deployment, security, privacy, backup and rollback gates pass;
- every merged phase is represented by successful CI, merged PR metadata and a verified `main` SHA.

## 10. Optional post-V1 phases

These are deliberately outside the five-phase V1 roadmap:

- Phase 9: additional warehouses, dbt/BI imports and enterprise connectors;
- Phase 10: experiment analysis and statistically governed causal methods;
- Phase 11: forecasting, predictive models and autonomous recommendations;
- Phase 12: enterprise policy packs, regional deployment and compliance certifications.

They must not be pulled into Phases 4-8 unless required by a core exit gate.

## 11. Failure and blocker policy

During an autonomous `build` run:

- failing CI must be debugged and corrected before merge;
- missing credentials are deployment blockers, while code, migrations, adapters, fixtures and tests continue where safe;
- irreversible external actions must not be guessed or simulated;
- breaking migrations require rollback plans and compatibility tests;
- unavailable services require an exact report of the completed commit or branch boundary;
- partial completion is acceptable only when the unmerged or undeployed boundary is explicit.

## 12. Final autonomous run confirmation template

```text
Metricmind build completed through Phase <N>

Merged pull requests:
- PR #... - <title> - <merge SHA>

Final main head:
<sha>

Validation:
- CI run: <id/status>
- Unit/API/integration/e2e tests: <summary>
- Security and migration checks: <summary>

Deployment:
- Staging: <verified/not performed and why>
- Production: <verified/not performed and why>

Remaining blockers:
- <none or exact blocker>
```

## 13. Roadmap status

| Phase | Status at plan creation | Completion evidence required |
|---|---|---|
| 1 | Complete | Existing merged trust-kernel commits and green CI |
| 2 | Complete | Existing semantic-memory commits and green CI |
| 3 | Complete | Existing investigation commits and green CI |
| 4 | Planned | JWT/RLS, durable stores, merged PRs and green CI |
| 5 | Planned | Accessible end-to-end onboarding and browser tests |
| 6 | Planned | Advanced semantic golden cases and Postgres tests |
| 7 | Planned | Scheduler and notification reliability tests |
| 8 | Planned | Security/load/deployment gates and verified main head |
