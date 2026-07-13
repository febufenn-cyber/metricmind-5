import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkspace } from '../src/config.js';
import { createSeedSemanticCatalog } from '../src/semantic-catalog.js';
import { buildInvestigationPlan, normalizeInvestigationQuestion } from '../src/investigation-planner.js';
import { compileInvestigationBreakdown } from '../src/investigation-compiler.js';

const now = new Date('2026-07-13T12:00:00.000Z');

function catalog() {
  return createSeedSemanticCatalog(defaultWorkspace);
}

test('normalizes a why-question into a bounded metric comparison', () => {
  assert.equal(normalizeInvestigationQuestion('Why did signups drop last week?'), 'signups drop last week?');
  const plan = buildInvestigationPlan({
    question: 'Why did signups drop last week?',
    workspace: defaultWorkspace,
    semanticCatalog: catalog(),
    now,
    dimensionIds: ['platform', 'source']
  });
  assert.equal(plan.baselinePlan.intent, 'period_comparison');
  assert.equal(plan.baselinePlan.metric.id, 'signup');
  assert.equal(plan.baselinePlan.metricVersion.id, 'signup-v1');
  assert.deepEqual(plan.dimensions.map((dimension) => dimension.id), ['platform', 'source']);
  assert.equal(plan.limits.causalClaimsAllowed, false);
});

test('refuses unapproved or excessive investigation dimensions', () => {
  assert.throws(
    () => buildInvestigationPlan({
      question: 'Why did signups drop last week?',
      workspace: defaultWorkspace,
      semanticCatalog: catalog(),
      now,
      dimensionIds: ['email']
    }),
    (error) => error.code === 'DIMENSION_NOT_ALLOWED_FOR_METRIC'
  );
  assert.throws(
    () => buildInvestigationPlan({
      question: 'Why did signups drop last week?',
      workspace: defaultWorkspace,
      semanticCatalog: catalog(),
      now,
      maxDimensions: 99
    }),
    (error) => error.code === 'INVALID_INVESTIGATION_LIMIT'
  );
});

test('investigation breakdown parameterizes semantic values', () => {
  const plan = buildInvestigationPlan({
    question: 'Why did signups drop last week?',
    workspace: defaultWorkspace,
    semanticCatalog: catalog(),
    now,
    dimensionIds: ['platform']
  });
  const malicious = "signup_completed' OR TRUE --";
  plan.baselinePlan.metricVersion.definition.predicates[0].value = malicious;
  const compiled = compileInvestigationBreakdown(plan.baselinePlan, plan.dimensions[0], defaultWorkspace);
  assert.equal(compiled.sql.includes(malicious), false);
  assert.ok(compiled.params.includes(malicious));
  assert.match(compiled.sql, /current_value/);
  assert.match(compiled.sql, /previous_value/);
});

test('rejects predictive investigation requests', () => {
  assert.throws(
    () => normalizeInvestigationQuestion('Predict why signups will drop next month'),
    (error) => error.code === 'UNSUPPORTED_INVESTIGATION_INTENT'
  );
});
