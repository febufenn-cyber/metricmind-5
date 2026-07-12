# Phase 1B: Secure Postgres connection

Phase 1B replaces the abstract warehouse contract with a concrete `pg` adapter for Cloudflare Hyperdrive. Every query uses a new logical client, while Hyperdrive owns the underlying connection pool.

## Safety properties

- The application accepts only the Hyperdrive `connectionString`; origin credentials are not stored in Supabase or returned to the browser.
- Every operation runs inside `BEGIN TRANSACTION READ ONLY`.
- Postgres enforces `statement_timeout` and `idle_in_transaction_session_timeout` locally inside the transaction.
- The adapter enforces a maximum returned-row count and closes the client after every request.
- Connection verification rejects a role with write privileges on the configured event table.
- Public errors expose stable categories and Postgres error codes, not server messages or connection strings.
- Freshness checks use indexed `MAX(timestamp)` aggregates and never count the full event table.
- Schema discovery lists metadata and event-name aggregates only; it never returns raw event rows.

## Create the reader role

Use a dedicated role and grant only the selected table:

```sql
CREATE ROLE metricmind_reader LOGIN PASSWORD '<strong-generated-password>';
ALTER ROLE metricmind_reader SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE your_database TO metricmind_reader;
GRANT USAGE ON SCHEMA analytics TO metricmind_reader;
GRANT SELECT ON analytics.product_events TO metricmind_reader;
```

Do not use the database owner, a Supabase service role, or a role that inherits writes through another role.

## Create Hyperdrive

```bash
export METRICMIND_READER_DATABASE_URL='postgres://metricmind_reader:...@host:5432/database?sslmode=require'

npx wrangler hyperdrive create metricmind-analytics \
  --connection-string="$METRICMIND_READER_DATABASE_URL" \
  --binding=HYPERDRIVE \
  --caching-disabled \
  --update-config
```

`--update-config` appends the generated binding ID to `wrangler.toml`. Keep the origin connection string out of source control.

## Local development

Start the disposable database:

```bash
docker compose up -d postgres
```

Expose its reader connection to Wrangler's local Hyperdrive binding:

```bash
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE='postgres://metricmind_reader:metricmind_local@127.0.0.1:55432/metricmind'
npx wrangler dev
```

Local Hyperdrive mode connects directly to Postgres, so it does not emulate Hyperdrive pooling or caching. Use `wrangler dev --remote` only against a controlled non-production database when validating the real Hyperdrive path.

## Verify the connection

```bash
curl -X POST http://localhost:8787/v1/data-sources/test
curl http://localhost:8787/v1/data-sources/schema
curl http://localhost:8787/v1/data-sources/freshness
```

The connection check succeeds only when:

- the configured table exists;
- the current role can `SELECT` it;
- the current role has none of `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, or `TRIGGER` on it;
- the active transaction reports `transaction_read_only = on`.

## Rotate credentials

Create a new database password, update Hyperdrive, verify the endpoint, and only then revoke the old credential:

```bash
npx wrangler hyperdrive update <HYPERDRIVE_ID> \
  --connection-string="$NEW_METRICMIND_READER_DATABASE_URL"
```

## Disconnect

Remove the `HYPERDRIVE` binding from the Worker deployment and delete the Hyperdrive configuration:

```bash
npx wrangler hyperdrive delete <HYPERDRIVE_ID>
```

Then revoke or drop the database role.

## Environment mapping

The canonical mapping may be changed without editing source code:

- `ORGANIZATION_TIMEZONE`
- `ANALYTICS_SCHEMA`
- `ANALYTICS_TABLE`
- `ANALYTICS_EVENT_NAME_COLUMN`
- `ANALYTICS_USER_ID_COLUMN`
- `ANALYTICS_OCCURRED_AT_COLUMN`
- `ANALYTICS_INSERTED_AT_COLUMN` (`none` when unavailable)
- `ANALYTICS_STATEMENT_TIMEOUT_MS`
- `ANALYTICS_MAXIMUM_ROWS`
- `ANALYTICS_FRESHNESS_THRESHOLD_MINUTES`

Identifiers are validated before being quoted into deterministic SQL.

## Tests

`npm test` runs unit, API, and golden-question tests. When the two test database URLs are present, it also provisions a real reader role and executes the complete question pipeline against disposable Postgres.

```bash
TEST_DATABASE_ADMIN_URL='postgres://postgres:postgres@127.0.0.1:5432/metricmind' \
TEST_DATABASE_READER_URL='postgres://metricmind_reader:metricmind_reader@127.0.0.1:5432/metricmind' \
npm test
```
