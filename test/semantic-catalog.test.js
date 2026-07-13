import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkspace } from '../src/config.js';
import {
  createMetricDraft,
  createSeedSemanticCatalog,
  definitionHash,
  getActiveMetricVersion,
  validateSemanticCatalog
} from '../src/semantic-catalog.js';

function catalog() {
  return createSeedSemanticCatalog(structuredClone(defaultWorkspace));
}

test('seed catalog converts every Phase 1 metric into one active immutable version', () => {
  const semantic = catalog();
  assert.equal(semantic.metrics.length, 3);
  assert.equal(semantic.versions.filter((version) => version.status === 'active').length, 3);
  const signup = getActiveMetricVersion(semantic, 'signup');
  assert.equal(signup.versionNumber, 1);
  assert.equal(signup.definition.aggregation.type, 'distinct_count');
  assert.equal(signup.definition.predicates[0].value, 'signup_completed');
});

test('definition hashes are stable across object key ordering', () => {
  assert.equal(
    definitionHash({ b: 2, a: { y: 2, x: 1 } }),
    definitionHash({ a: { x: 1, y: 2 }, b: 2 })
  );
});

test('creating a draft leaves the active version unchanged', () => {
  const semantic = catalog();
  const active = getActiveMetricVersion(semantic, 'signup');
  const nextDefinition = structuredClone(active.definition);
  nextDefinition.predicates[0].value = 'email_verified';
  const result = createMetricDraft(semantic, 'signup', nextDefinition, 'editor-1');

  assert.equal(getActiveMetricVersion(result.catalog, 'signup').id, active.id);
  assert.equal(result.draft.status, 'draft');
  assert.equal(result.draft.versionNumber, 2);
  assert.equal(result.draft.definition.predicates[0].value, 'email_verified');
  assert.equal(active.definition.predicates[0].value, 'signup_completed');
});

test('catalog rejects multiple active versions for the same metric', () => {
  const semantic = catalog();
  const duplicate = structuredClone(getActiveMetricVersion(semantic, 'signup'));
  duplicate.id = 'signup-v2';
  duplicate.versionNumber = 2;
  semantic.versions.push(duplicate);
  assert.throws(
    () => validateSemanticCatalog(semantic),
    (error) => error.code === 'ACTIVE_METRIC_VERSION_REQUIRED'
  );
});

test('catalog rejects unsupported predicate operators', () => {
  const semantic = catalog();
  const signup = getActiveMetricVersion(semantic, 'signup');
  signup.definition.predicates[0].operator = 'contains_sql';
  signup.definitionHash = definitionHash(signup.definition);
  assert.throws(
    () => validateSemanticCatalog(semantic),
    (error) => error.code === 'INVALID_SEMANTIC_PREDICATE'
  );
});
