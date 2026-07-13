import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { MemoryInvestigationStore } from '../src/investigation-store.js';

function analyticsBinding() {
  return {
    async query(sql) {
      const timestamp = new Date().toISOString();
      if (sql.includes('max_ingested_at')) {
        return { rows: [{ max_ingested_at: timestamp, max_occurred_at: timestamp, observed_at: timestamp }] };
      }
      if (sql.includes('information_schema.columns')) {
        return { rows: [
          { column_name: 'event_name', data_type: 'text', is_nullable: 'NO' },
          { column_name: 'user_id', data_type: 'text', is_nullable: 'NO' },
          { column_name: 'occurred_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
          { column_name: 'inserted_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
          { column_name: 'platform', data_type: 'text', is_nullable: 'YES' },
          { column_name: 'source', data_type: 'text', is_nullable: 'YES' },
          { column_name: 'country', data_type: 'text', is_nullable: 'YES' },
          { column_name: 'app_version', data_type: 'text', is_nullable: 'YES' }
        ] };
      }
      if (sql.includes('AS event_name')) {
        return { rows: [{ event_name: 'signup_completed', event_count: '100' }] };
      }
      if (sql.includes('AS current_value')) {
        return { rows: [
          { segment: 'ios', current_value: 20, previous_value: 50 },
          { segment: 'android', current_value: 35, previous_value: 30 }
        ] };
      }
      if (sql.includes('AS period')) {
        return { rows: [
          { period: 'current', value: 80 },
          { period: 'previous', value: 100 }
        ] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

test('worker creates, stores, lists, and retrieves an investigation', async () => {
  const store = new MemoryInvestigationStore();
  const env = { ANALYTICS_DB: analyticsBinding(), INVESTIGATION_STORE: store };
  const create = await worker.fetch(new Request('https://metricmind.test/v1/investigations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Metricmind-Actor': 'pm@example.com' },
    body: JSON.stringify({ question: 'Why did signups drop last week?', dimensions: ['platform'] })
  }), env);
  assert.equal(create.status, 201);
  const created = await create.json();
  assert.equal(created.persistence, 'persistent');
  assert.equal(created.investigation.causalStatus, 'not_established');
  assert.equal(created.investigation.requestedBy, 'pm@example.com');

  const list = await worker.fetch(new Request('https://metricmind.test/v1/investigations?limit=10'), env);
  assert.equal(list.status, 200);
  const listed = await list.json();
  assert.equal(listed.investigations.length, 1);

  const detail = await worker.fetch(new Request(`https://metricmind.test/v1/investigations/${created.investigation.id}`), env);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).investigation.id, created.investigation.id);
});

test('worker returns 404 for an unknown investigation', async () => {
  const env = { INVESTIGATION_STORE: new MemoryInvestigationStore() };
  const response = await worker.fetch(new Request('https://metricmind.test/v1/investigations/missing'), env);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'INVESTIGATION_NOT_FOUND');
});
