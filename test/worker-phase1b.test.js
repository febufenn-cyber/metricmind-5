import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { workspaceFromEnv } from '../src/worker.js';

function bindingForRows(resolver) {
  return {
    async query(sql, params) {
      return { rows: await resolver(sql, params) };
    }
  };
}

test('workspace can map a Postgres table and omit inserted_at through environment configuration', () => {
  const workspace = workspaceFromEnv({
    ANALYTICS_SCHEMA: 'events',
    ANALYTICS_TABLE: 'track',
    ANALYTICS_INSERTED_AT_COLUMN: 'none'
  });
  assert.equal(workspace.dataSource.schema, 'events');
  assert.equal(workspace.dataSource.table, 'track');
  assert.equal(workspace.dataSource.columns.insertedAt, null);
});

test('connection endpoint returns the verified read-only role contract', async () => {
  const env = {
    ANALYTICS_DB: bindingForRows(async () => [{
      current_user: 'reader',
      database_name: 'app',
      transaction_read_only: 'on',
      table_exists: true,
      can_select: true,
      can_write: false
    }])
  };
  const response = await worker.fetch(
    new Request('https://metricmind.test/v1/data-sources/test', { method: 'POST' }),
    env
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.readOnlyTransaction, true);
  assert.equal(payload.canWrite, false);
});

test('freshness endpoint returns aggregate ingestion health without raw rows', async () => {
  const timestamp = new Date().toISOString();
  const env = {
    ANALYTICS_DB: bindingForRows(async () => [{
      max_ingested_at: timestamp,
      max_occurred_at: timestamp,
      observed_at: timestamp
    }])
  };
  const response = await worker.fetch(
    new Request('https://metricmind.test/v1/data-sources/freshness'),
    env
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, 'fresh');
  assert.equal('rows' in payload, false);
});
