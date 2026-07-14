import test from 'node:test';
import assert from 'node:assert/strict';
import appWorker from '../src/app-worker.js';
import { defaultWorkspace } from '../src/config.js';
import { compileMeasure, compileJoinedMeasure, validateJoinPath, verifyMeasureResult } from '../src/advanced-measures.js';
import { compileFunnel, verifyFunnelResult } from '../src/funnel-analytics.js';
import { compileRetention, verifyRetentionResult } from '../src/retention-analytics.js';
import { assertSafeSql } from '../src/sql-policy.js';

const period = { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-07-01T00:00:00Z') };

test('sum and average measures remain parameterized and currency-normalized', () => {
  const compiled = compileMeasure({ aggregation: 'sum', column: 'amount', currency: { column: 'currency', code: 'INR', normalized: true } }, period, defaultWorkspace);
  assertSafeSql(compiled, defaultWorkspace);
  assert.equal(compiled.params.at(-1), 'INR');
  assert.doesNotMatch(compiled.sql, /INR/);
  assert.deepEqual(verifyMeasureResult({ rows: [{ value: '42.5' }] }), { kind: 'measure', value: 42.5 });
  assert.throws(() => compileMeasure({ aggregation: 'sum', column: 'amount', currency: { column: 'currency', code: 'INR' } }, period, defaultWorkspace), (error) => error.code === 'UNNORMALIZED_CURRENCY');
});

test('verified joins permit only one-to-one or many-to-one configured paths', () => {
  const joinPath = {
    id: 'events_to_accounts', status: 'verified', cardinality: 'many_to_one',
    left: { schema: 'analytics', table: 'product_events', column: 'account_id' },
    right: { schema: 'analytics', table: 'accounts', column: 'id' }
  };
  const workspace = structuredClone(defaultWorkspace);
  workspace.dataSource.verifiedJoinPaths = [joinPath];
  validateJoinPath(joinPath, workspace);
  const compiled = compileJoinedMeasure({ aggregation: 'average', column: 'plan_value', valueSide: 'right', joinPath }, period, workspace);
  assertSafeSql(compiled, workspace);
  assert.ok(compiled.allowedTables.includes('"analytics"."accounts"'));
  assert.throws(() => validateJoinPath({ ...joinPath, cardinality: 'one_to_many' }, workspace), (error) => error.code === 'UNSAFE_JOIN_CARDINALITY');
});

test('ordered funnel binds event names and calculates step conversion', () => {
  const definition = { conversionWindowDays: 7, steps: [{ eventName: 'signup_completed' }, { eventName: 'workspace_created' }, { eventName: 'subscription_started' }] };
  const compiled = compileFunnel(definition, period, defaultWorkspace);
  assertSafeSql(compiled, defaultWorkspace);
  assert.deepEqual(compiled.params.slice(-3), definition.steps.map((step) => step.eventName));
  for (const step of definition.steps) assert.doesNotMatch(compiled.sql, new RegExp(step.eventName));
  const result = verifyFunnelResult(compiled, { rows: [{ step_1: 100, step_2: 60, step_3: 15 }] }, definition);
  assert.equal(result.steps[2].conversionFromFirst, 0.15);
  assert.equal(result.steps[2].conversionFromPrevious, 0.25);
});

test('retention compiler enforces complete cohort maturity and approved CTE relations', () => {
  const compiled = compileRetention({ cohortEvent: 'signup_completed', returnEvent: 'session_started', grain: 'week', periods: 4 }, period, defaultWorkspace);
  assertSafeSql(compiled, defaultWorkspace);
  assert.match(compiled.sql, /make_interval\(weeks => \$6\)/);
  assert.deepEqual(compiled.allowedRelations, ['cohorts', 'activity', 'cohort_sizes']);
  const result = verifyRetentionResult({ rows: [{ cohort_start: '2026-06-01T00:00:00Z', period_index: 1, retained_users: 40, cohort_users: 100 }] });
  assert.equal(result.cohorts[0].retentionRate, 0.4);
});

test('advanced measure preview executes through authenticated read-only binding', async () => {
  const response = await appWorker.fetch(new Request('https://metricmind.test/v1/advanced/measures/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' },
    body: JSON.stringify({ period: 'last_30_complete_days', definition: { aggregation: 'sum', column: 'amount' } })
  }), {
    API_TOKEN: 'secret',
    ANALYTICS_DB: { async query(sql, params, options) { assert.equal(options.readOnly, true); return { rows: [{ value: 1250 }] }; } }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.result.value, 1250);
  assert.equal(payload.evidence.analysisType, 'measure');
});
