import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkspace } from '../src/config.js';
import { compileQuery } from '../src/compiler.js';
import { interpretQuestion } from '../src/interpreter.js';
import { answerQuestion } from '../src/pipeline.js';
import { buildQueryPlan } from '../src/planner.js';
import {
  createSeedSemanticCatalog,
  definitionHash,
  validateSemanticCatalog
} from '../src/semantic-catalog.js';
import { assertSafeSql } from '../src/sql-policy.js';
import { StaticExecutor } from '../src/executor.js';

const now = new Date('2026-07-12T12:30:00.000Z');

function catalog() {
  return createSeedSemanticCatalog(structuredClone(defaultWorkspace));
}

test('question interpretation pins the active semantic metric version', () => {
  const semantic = catalog();
  const result = interpretQuestion('How many signups happened yesterday?', defaultWorkspace, semantic);
  assert.equal(result.metricId, 'signup');
  assert.equal(result.metricVersionId, 'signup-v1');
  assert.match(result.definitionHash, /^fnv1a64:/);
});

test('equal-strength aliases across metrics are rejected as ambiguous', () => {
  const semantic = catalog();
  const signupVersion = semantic.versions.find((version) => version.metricId === 'signup');
  semantic.metrics.push({
    id: 'workspace_signup',
    key: 'workspace_signup',
    name: 'Workspace signup',
    description: 'Distinct workspaces created.',
    aliases: ['signups'],
    ownerId: 'system',
    category: 'product',
    createdAt: new Date(0).toISOString()
  });
  const version = structuredClone(signupVersion);
  version.id = 'workspace_signup-v1';
  version.metricId = 'workspace_signup';
  version.definition = structuredClone(version.definition);
  version.definitionHash = definitionHash(version.definition);
  semantic.versions.push(version);
  validateSemanticCatalog(semantic);

  assert.throws(
    () => interpretQuestion('Show signups yesterday', defaultWorkspace, semantic),
    (error) => error.code === 'AMBIGUOUS_METRIC'
  );
});

test('semantic predicate values are bound parameters rather than SQL text', () => {
  const semantic = catalog();
  const signup = semantic.versions.find((version) => version.metricId === 'signup');
  signup.definition.predicates[0].value = "signup_completed' OR TRUE --";
  signup.definitionHash = definitionHash(signup.definition);
  validateSemanticCatalog(semantic);
  const interpretation = interpretQuestion('Show signups yesterday', defaultWorkspace, semantic);
  const plan = buildQueryPlan(interpretation, defaultWorkspace, now, semantic);
  const compiled = compileQuery(plan, defaultWorkspace);
  assert.equal(compiled.params[0], "signup_completed' OR TRUE --");
  assert.equal(compiled.sql.includes("OR TRUE"), false);
  assert.equal(assertSafeSql(compiled, defaultWorkspace), true);
});

test('semantic answers expose immutable version lineage', async () => {
  const semantic = catalog();
  const executor = new StaticExecutor(async () => [{ value: 12 }]);
  const result = await answerQuestion({
    question: 'How many signups happened yesterday?',
    workspace: defaultWorkspace,
    semanticCatalog: semantic,
    executor,
    now
  });
  assert.equal(result.answer.evidence.metricVersion.id, 'signup-v1');
  assert.equal(result.answer.evidence.semanticLineage.metricId, 'signup');
  assert.equal(result.answer.evidence.semanticLineage.definitionHash, result.interpretation.definitionHash);
});

test('ratio metrics compile verified numerator and denominator versions', () => {
  const semantic = catalog();
  const signup = semantic.versions.find((version) => version.metricId === 'signup');
  semantic.metrics.push({
    id: 'activation_rate',
    key: 'activation_rate',
    name: 'Activation rate',
    description: 'Activated users divided by signed-up users.',
    aliases: ['activation rate'],
    ownerId: 'system',
    category: 'product',
    createdAt: new Date(0).toISOString()
  });
  const definition = {
    entityId: 'user',
    aggregation: {
      type: 'ratio',
      numeratorMetricId: 'activation',
      denominatorMetricId: 'signup'
    },
    source: signup.definition.source,
    timestampColumn: signup.definition.timestampColumn,
    predicates: [],
    exclusionSetIds: [],
    allowedDimensionIds: [],
    timePolicy: signup.definition.timePolicy,
    historyPolicy: 'restated'
  };
  semantic.versions.push({
    id: 'activation_rate-v1',
    metricId: 'activation_rate',
    versionNumber: 1,
    status: 'active',
    definition,
    definitionHash: definitionHash(definition),
    createdBy: 'system',
    createdAt: new Date(0).toISOString(),
    verifiedBy: 'system',
    verifiedAt: new Date(0).toISOString(),
    activatedAt: new Date(0).toISOString()
  });
  validateSemanticCatalog(semantic);

  const interpretation = interpretQuestion('Show activation rate yesterday', defaultWorkspace, semantic);
  const plan = buildQueryPlan(interpretation, defaultWorkspace, now, semantic);
  const compiled = compileQuery(plan, defaultWorkspace);
  assert.equal(compiled.valueKind, 'ratio');
  assert.equal(compiled.expectedShape, 'single_value');
  assert.equal(compiled.semanticLineage.dependencies.numerator.metricId, 'activation');
  assert.equal(compiled.semanticLineage.dependencies.denominator.metricId, 'signup');
  assert.equal(assertSafeSql(compiled, defaultWorkspace), true);
});
