# Phase 7: Monitoring, alerts, and scheduled briefs

## Objective

Phase 7 turns verified analytics into idempotent scheduled evaluations and evidence-linked notifications without autonomous remediation or causal claims.

## Rule types

- threshold rules on an observed aggregate value;
- percentage-change rules on complete-period comparisons;
- missing-data rules based on freshness state;
- deterministic anomaly rules using a documented z-score over at least seven baseline points.

## Safety behavior

Business alerts are suppressed whenever ingestion freshness is not `fresh`. During a freshness incident, only an explicit `missing_data` rule may trigger. Cooldowns, schedule-window idempotency keys, and verified destinations prevent repeated notifications.

## Delivery

Email, Slack, and webhook destinations are represented by verified destination IDs. Provider adapters receive the ID and message; raw destination secrets and webhook URLs are not stored in rule JSON. Delivery retries are bounded to three attempts and terminal failures are recorded as `dead_letter`.

## APIs

- `GET /v1/monitoring/rules`
- `POST /v1/monitoring/rules`
- `POST /v1/monitoring/rules/{ruleId}/evaluate`
- `GET /v1/monitoring/deliveries`

Rule mutation requires organization-administrator permission and durable storage. Reads use normal organization authorization.

## Scheduler

The Worker runs hourly. Each rule maps its hourly, daily, or weekly cadence to a deterministic window and claims a unique `(rule, window)` key before querying the warehouse. Scheduled execution loads the active semantic catalog, checks freshness, runs the saved question through the normal trusted pipeline, evaluates the rule, delivers notifications, and stores evidence.

## Briefs

Every scheduler run produces a deterministic brief with triggered, suppressed, and non-triggered records. Briefs reference evidence IDs and preserve `causalStatus: not_established`.

## Exit gate

Organizations can persist verified alert rules, execute them idempotently, suppress misleading alerts during stale ingestion, deliver through bounded adapters, and inspect run and delivery history. Actual external delivery requires configured provider bindings.
