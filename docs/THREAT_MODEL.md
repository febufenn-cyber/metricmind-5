# Metricmind threat model

## Protected assets

- customer warehouse confidentiality and read-only integrity;
- organization membership and tenant boundaries;
- semantic metric definitions and approval history;
- investigation, monitoring, and delivery records;
- authentication, database, Hyperdrive, rate-limit, log, and notification credentials;
- evidence accuracy and causal-status integrity.

## Trust boundaries

1. Browser to Cloudflare Worker.
2. Worker to Supabase authentication and application metadata.
3. Worker through Hyperdrive to the customer read-only warehouse.
4. Scheduled Worker to notification providers.
5. GitHub and CI to deployment environments.

## Principal threats and controls

### Tenant escape

Threat: a user selects or submits another organization's identifier.

Controls: verified JWT subject, active membership lookup, organization-scoped queries, role authorization, RLS, organization-keyed records, and negative-path tests.

### JWT forgery, replay, or stale access

Threat: forged signatures, incorrect issuer or audience, expired tokens, or suspended membership.

Controls: approved verifier binding or legacy HS256 validation, registered-claim checks, active membership on every request, no trust in body actor fields, short-lived tokens managed by Supabase, and bootstrap removal before production.

### Warehouse writes or SQL injection

Threat: generated or supplied text mutates or escapes the allowlisted warehouse.

Controls: deterministic compilers, bound values, table/relation allowlists, forbidden-operation policy, dedicated read-only transactions, reader permission verification, statement deadlines, result caps, and no arbitrary SQL API.

### Prompt or semantic injection

Threat: untrusted labels, aliases, event names, or imported descriptions influence queries or system behavior.

Controls: structured semantic data, identifier validation, parameter binding, immutable verified versions, human approval, ambiguity refusal, and no execution of stored text as code.

### Personal-data leakage

Threat: raw rows, identifiers, sensitive columns, query parameters, or logs reveal personal information.

Controls: aggregate-only API, dimension privacy classifications, restricted-column checks, bounded results, evidence redaction, no raw-user export, CSP, and no third-party browser scripts.

### SSRF and notification-secret exposure

Threat: a user supplies arbitrary webhook URLs or retrieves provider credentials.

Controls: rules reference verified destination IDs only; provider adapters own secrets; no generic URL fetch; bounded payloads, retries, audit records, and destination revocation errors.

### Alert storms and duplicated jobs

Threat: repeated schedules or provider retries flood recipients.

Controls: deterministic window idempotency keys, unique claims, cooldowns, verified destination cap, bounded retries, dead-letter state, and stale-data suppression.

### Causal overclaiming

Threat: associations are presented as established causes.

Controls: `causalStatus: not_established`, bounded hypotheses, contradictions, evidence links, no-change suppression, append-only human reviews, and non-causal monitoring language.

### Credential leakage in source or telemetry

Threat: secrets enter Git, logs, errors, or limiter keys.

Controls: repository scanner, environment-managed secrets, recursive log redaction, sanitized public errors, hashed limiter identities, and rotation procedures.

### Availability and cost abuse

Threat: expensive queries, excessive API requests, large results, or stuck provider calls exhaust resources.

Controls: rate limits, query range and row caps, statement timeouts, maximum dimensions, bounded funnel/retention definitions, scheduled concurrency claims, and load tests.

## Residual risks

- Incorrect customer-defined metrics or event instrumentation may still produce misleading but reproducible results.
- A compromised privileged metadata service role can bypass RLS and must be tightly controlled.
- In-process rate limits are only a local fallback; production requires a distributed binding.
- Provider adapters and deployment credentials are outside the repository and require separate security review.
- This model does not constitute a penetration test or compliance certification.

## Review triggers

Revisit this model when adding a warehouse, custom SQL, third-party import, causal method, predictive model, autonomous action, regional deployment, or new regulated data category.
