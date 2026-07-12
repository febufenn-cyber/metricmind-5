import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkspace } from '../src/config.js';
import { interpretQuestion } from '../src/interpreter.js';
import { buildQueryPlan } from '../src/planner.js';
import { compileQuery } from '../src/compiler.js';
import { assertSafeSql } from '../src/sql-policy.js';
import { StaticExecutor } from '../src/executor.js';
import { answerQuestion } from '../src/pipeline.js';

const now = new Date('2026-07-12T12:30:00.000Z');

test('interprets a verified metric and complete calendar period', () => {
  const result = interpretQuestion('How did signups change last week?', defaultWorkspace);
  assert.equal(result.intent, 'period_comparison');
  assert.equal(result.metricId, 'signup');
  assert.equal(result.period, 'previous_calendar_week');
  assert.equal(result.timezone, 'Asia/Kolkata');
});

test('compiles parameterized SQL against only the allowlisted table', () => {
  const interpretation = interpretQuestion('Show daily signups for the last 30 days', defaultWorkspace);
  const plan = buildQueryPlan(interpretation, defaultWorkspace, now);
  const compiled = compileQuery(plan, defaultWorkspace);
  assert.match(compiled.sql, /"analytics"\."product_events"/);
  assert.match(compiled.sql, /\$1/);
  assert.equal(compiled.params[0], 'signup_completed');
  assert.equal(assertSafeSql(compiled, defaultWorkspace), true);
});

test('blocks write requests before SQL generation', () => {
  assert.throws(
    () => interpretQuestion('Delete all signup events', defaultWorkspace),
    (error) => error.code === 'WRITE_REQUEST_BLOCKED'
  );
});

test('blocks personal-data exports', () => {
  assert.throws(
    () => interpretQuestion('Export all user email addresses', defaultWorkspace),
    (error) => error.code === 'PII_REQUEST_BLOCKED'
  );
});

test('blocks non-allowlisted SQL and mutations', () => {
  assert.throws(
    () => assertSafeSql({ sql: 'SELECT * FROM "auth"."users"', params: ['x'] }, defaultWorkspace),
    (error) => ['FORBIDDEN_SCHEMA', 'TABLE_NOT_ALLOWLISTED'].includes(error.code)
  );
  assert.throws(
    () => assertSafeSql({ sql: 'DELETE FROM "analytics"."product_events"', params: ['x'] }, defaultWorkspace),
    (error) => ['NON_SELECT_BLOCKED', 'FORBIDDEN_SQL'].includes(error.code)
  );
});

test('answers a comparison using deterministic arithmetic and evidence', async () => {
  const executor = new StaticExecutor(async ({ expectedShape }) => {
    assert.equal(expectedShape, 'period_comparison');
    return [
      { period: 'current', value: 824 },
      { period: 'previous', value: 917 }
    ];
  });
  const result = await answerQuestion({
    question: 'How did signups change last week?',
    workspace: defaultWorkspace,
    executor,
    now
  });
  assert.equal(result.answer.chart.type, 'comparison_bars');
  assert.match(result.answer.headline, /decreased 10\.1%/);
  assert.equal(result.answer.evidence.metric.status, 'verified');
  assert.match(result.answer.evidence.sql, /^SELECT/);
});

test('requires a known verified metric', () => {
  assert.throws(
    () => interpretQuestion('Show revenue yesterday', defaultWorkspace),
    (error) => error.code === 'UNKNOWN_METRIC'
  );
});

test('rejects causal questions in Phase 1', () => {
  assert.throws(
    () => interpretQuestion('Why did signups drop last week?', defaultWorkspace),
    (error) => error.code === 'UNSUPPORTED_INTENT'
  );
});
