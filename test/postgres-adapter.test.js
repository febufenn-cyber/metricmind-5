import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresQueryAdapter, createHyperdriveAdapter } from '../src/postgres-adapter.js';
import { discoverDataSource, getDataSourceFreshness, verifyDataSourceConnection } from '../src/data-source.js';

function fakeClient({ result = { rows: [{ value: 1 }] }, failure = null } = {}) {
  const calls = [];
  return {
    calls,
    async connect() { calls.push(['connect']); },
    async query(input) {
      calls.push(['query', input]);
      if (typeof input === 'object' && failure) throw failure;
      if (typeof input === 'object') return result;
      return { rows: [] };
    },
    async end() { calls.push(['end']); }
  };
}

test('Postgres adapter opens a bounded read-only transaction and closes the client', async () => {
  const client = fakeClient({ result: { rows: [{ value: '3' }] } });
  const adapter = new PostgresQueryAdapter({
    connectionString: 'postgres://redacted',
    clientFactory: async () => client
  });
  const result = await adapter.query('SELECT $1::int AS value', [3], {
    readOnly: true,
    statementTimeoutMs: 500,
    maximumRows: 1
  });
  assert.deepEqual(result.rows, [{ value: '3' }]);
  assert.equal(client.calls[1][1], 'BEGIN TRANSACTION READ ONLY');
  assert.equal(client.calls[2][1], "SET LOCAL statement_timeout = '500ms'");
  assert.deepEqual(client.calls[4][1], { text: 'SELECT $1::int AS value', values: [3] });
  assert.equal(client.calls[5][1], 'ROLLBACK');
  assert.deepEqual(client.calls.at(-1), ['end']);
});

test('Postgres adapter refuses execution without an explicit read-only contract', async () => {
  const adapter = new PostgresQueryAdapter({
    connectionString: 'postgres://redacted',
    clientFactory: async () => fakeClient()
  });
  await assert.rejects(
    () => adapter.query('SELECT 1', [], {}),
    { code: 'WAREHOUSE_READ_ONLY_REQUIRED' }
  );
});

test('Postgres adapter classifies statement timeouts without leaking server messages', async () => {
  const client = fakeClient({ failure: Object.assign(new Error('secret host detail'), { code: '57014' }) });
  const adapter = new PostgresQueryAdapter({
    connectionString: 'postgres://redacted',
    clientFactory: async () => client
  });
  await assert.rejects(
    () => adapter.query('SELECT 1', [], { readOnly: true, statementTimeoutMs: 50, maximumRows: 1 }),
    (error) => error.code === 'WAREHOUSE_TIMEOUT'
      && error.details.postgresCode === '57014'
      && !error.message.includes('secret')
  );
  assert.ok(client.calls.some((call) => call[1] === 'ROLLBACK'));
  assert.deepEqual(client.calls.at(-1), ['end']);
});

test('Hyperdrive adapter fails closed when the binding is missing', async () => {
  const adapter = createHyperdriveAdapter(undefined, { clientFactory: async () => fakeClient() });
  await assert.rejects(
    () => adapter.query('SELECT 1', [], { readOnly: true, statementTimeoutMs: 50, maximumRows: 1 }),
    { code: 'WAREHOUSE_NOT_CONFIGURED' }
  );
});

const workspace = {
  dataSource: {
    schema: 'analytics',
    table: 'product_events',
    freshnessThresholdMinutes: 60,
    columns: {
      eventName: 'event_name',
      userId: 'user_id',
      occurredAt: 'occurred_at',
      insertedAt: 'inserted_at'
    },
    restrictedColumns: ['email']
  }
};

test('Connection verification rejects a role that can write', async () => {
  const executor = {
    async query() {
      return {
        rows: [{
          current_user: 'reader',
          database_name: 'app',
          transaction_read_only: 'on',
          table_exists: true,
          can_select: true,
          can_write: true
        }],
        durationMs: 1
      };
    }
  };
  await assert.rejects(
    () => verifyDataSourceConnection({ executor, workspace }),
    { code: 'DATA_SOURCE_ROLE_CAN_WRITE' }
  );
});

test('Schema discovery reports required-column and restricted-column findings', async () => {
  let call = 0;
  const executor = {
    async query() {
      call += 1;
      if (call === 1) {
        return {
          rows: [
            { column_name: 'event_name', data_type: 'text', is_nullable: 'NO' },
            { column_name: 'user_id', data_type: 'text', is_nullable: 'NO' },
            { column_name: 'occurred_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
            { column_name: 'email', data_type: 'text', is_nullable: 'YES' }
          ],
          durationMs: 2
        };
      }
      return {
        rows: [{ event_name: 'signup_completed', event_count: '12' }],
        durationMs: 3
      };
    }
  };
  const result = await discoverDataSource({
    executor,
    workspace,
    now: new Date('2026-07-12T12:00:00.000Z')
  });
  assert.equal(result.mapping.valid, true);
  assert.deepEqual(result.mapping.restrictedColumnsPresent, ['email']);
  assert.deepEqual(result.topEvents, [{ eventName: 'signup_completed', count: 12 }]);
});

test('Freshness inspection uses inserted_at and returns aggregate metadata', async () => {
  const executor = {
    async query() {
      return {
        rows: [{
          max_ingested_at: '2026-07-12T11:30:00.000Z',
          max_occurred_at: '2026-07-12T11:29:00.000Z',
          observed_at: '2026-07-12T12:00:00.000Z'
        }],
        durationMs: 4
      };
    }
  };
  const result = await getDataSourceFreshness({
    executor,
    workspace,
    now: new Date('2026-07-12T12:00:00.000Z')
  });
  assert.equal(result.status, 'fresh');
  assert.equal(result.sourceColumn, 'inserted_at');
});
