import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverDataSource } from '../src/data-source.js';

test('schema discovery reports missing required columns without issuing a doomed event query', async () => {
  let calls = 0;
  const executor = {
    async query() {
      calls += 1;
      return {
        rows: [
          { column_name: 'event_name', data_type: 'text', is_nullable: 'NO' },
          { column_name: 'inserted_at', data_type: 'timestamp with time zone', is_nullable: 'NO' }
        ],
        durationMs: 2
      };
    }
  };
  const workspace = {
    dataSource: {
      schema: 'analytics',
      table: 'product_events',
      columns: {
        eventName: 'event_name',
        userId: 'user_id',
        occurredAt: 'occurred_at',
        insertedAt: 'inserted_at'
      },
      restrictedColumns: []
    }
  };

  const result = await discoverDataSource({
    executor,
    workspace,
    now: new Date('2026-07-12T12:00:00.000Z')
  });

  assert.equal(calls, 1);
  assert.equal(result.mapping.valid, false);
  assert.deepEqual(result.mapping.missingRequiredColumns, ['user_id', 'occurred_at']);
  assert.deepEqual(result.topEvents, []);
});
