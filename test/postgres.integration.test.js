import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkspace } from '../src/config.js';
import { BindingQueryExecutor } from '../src/executor.js';
import { PostgresQueryAdapter } from '../src/postgres-adapter.js';
import { discoverDataSource, getDataSourceFreshness, verifyDataSourceConnection } from '../src/data-source.js';
import { answerQuestion } from '../src/pipeline.js';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const readerUrl = process.env.TEST_DATABASE_READER_URL;
const enabled = Boolean(adminUrl && readerUrl);

test('Phase 1B executes a verified question against disposable Postgres', { skip: !enabled }, async () => {
  const { Client } = await import('pg');
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query('DROP SCHEMA IF EXISTS analytics CASCADE');
    await admin.query('DROP ROLE IF EXISTS metricmind_reader');
    await admin.query(`
      CREATE SCHEMA analytics;
      CREATE TABLE analytics.product_events (
        event_id uuid PRIMARY KEY,
        user_id text NOT NULL,
        event_name text NOT NULL,
        occurred_at timestamptz NOT NULL,
        inserted_at timestamptz NOT NULL,
        platform text,
        source text,
        country text,
        app_version text
      );
      CREATE INDEX product_events_occurred_at_idx ON analytics.product_events (occurred_at DESC);
      CREATE INDEX product_events_inserted_at_idx ON analytics.product_events (inserted_at DESC);
      INSERT INTO analytics.product_events
        (event_id, user_id, event_name, occurred_at, inserted_at, platform, source, country, app_version)
      VALUES
        ('00000000-0000-0000-0000-000000000001', 'u1', 'signup_completed', '2026-07-11T00:00:00Z', '2026-07-11T00:01:00Z', 'ios', 'organic', 'IN', '1.0.0'),
        ('00000000-0000-0000-0000-000000000002', 'u2', 'signup_completed', '2026-07-11T01:00:00Z', '2026-07-11T01:01:00Z', 'android', 'paid', 'IN', '1.0.0'),
        ('00000000-0000-0000-0000-000000000003', 'u3', 'signup_completed', '2026-07-11T02:00:00Z', '2026-07-11T02:01:00Z', 'web', 'organic', 'US', '1.0.1'),
        ('00000000-0000-0000-0000-000000000004', 'u1', 'workspace_created', '2026-07-11T03:00:00Z', '2026-07-11T03:01:00Z', 'ios', 'organic', 'IN', '1.0.0'),
        ('00000000-0000-0000-0000-000000000005', 'u4', 'signup_completed', '2026-07-09T02:00:00Z', '2026-07-09T02:01:00Z', 'web', 'referral', 'GB', '1.0.0');
      CREATE ROLE metricmind_reader LOGIN PASSWORD 'metricmind_reader';
      ALTER ROLE metricmind_reader SET default_transaction_read_only = on;
      GRANT CONNECT ON DATABASE metricmind TO metricmind_reader;
      GRANT USAGE ON SCHEMA analytics TO metricmind_reader;
      GRANT SELECT ON analytics.product_events TO metricmind_reader;
    `);
  } finally {
    await admin.end();
  }

  const adapter = new PostgresQueryAdapter({ connectionString: readerUrl });
  const executor = new BindingQueryExecutor(adapter);
  const workspace = structuredClone(defaultWorkspace);
  const now = new Date('2026-07-12T12:00:00.000Z');

  const connection = await verifyDataSourceConnection({ executor, workspace });
  assert.equal(connection.currentUser, 'metricmind_reader');
  assert.equal(connection.canWrite, false);

  const discovery = await discoverDataSource({ executor, workspace, now });
  assert.equal(discovery.mapping.valid, true);
  assert.ok(discovery.topEvents.some((event) => event.eventName === 'signup_completed'));

  const freshness = await getDataSourceFreshness({ executor, workspace, now });
  assert.equal(freshness.status, 'stale');
  assert.equal(freshness.sourceColumn, 'inserted_at');

  const result = await answerQuestion({
    question: 'How many signups happened yesterday?',
    workspace,
    executor,
    now,
    freshness
  });
  assert.equal(result.answer.chart.type, 'metric');
  assert.equal(result.answer.chart.value, 3);
  assert.equal(result.answer.evidence.freshness.status, 'stale');

  await assert.rejects(
    () => adapter.query('SELECT pg_sleep(0.2)', [], {
      readOnly: true,
      statementTimeoutMs: 50,
      maximumRows: 1
    }),
    { code: 'WAREHOUSE_TIMEOUT' }
  );
});
