import { validateWorkspace } from './config.js';
import { interpretQuestion } from './interpreter.js';
import { buildQueryPlan } from './planner.js';
import { compileQuery } from './compiler.js';
import { assertSafeSql } from './sql-policy.js';
import { verifyResult } from './verifier.js';
import { composeAnswer } from './composer.js';
import { createSeedSemanticCatalog, validateSemanticCatalog } from './semantic-catalog.js';

export async function answerQuestion({
  question,
  workspace,
  semanticCatalog = createSeedSemanticCatalog(workspace),
  executor,
  now = new Date(),
  freshness = { status: 'unknown', warning: null }
}) {
  validateWorkspace(workspace);
  validateSemanticCatalog(semanticCatalog);
  const interpretation = interpretQuestion(question, workspace, semanticCatalog);
  const plan = buildQueryPlan(interpretation, workspace, now, semanticCatalog);
  const compiled = compileQuery(plan, workspace);
  assertSafeSql(compiled, workspace);
  const execution = await executor.query({
    ...compiled,
    plan,
    statementTimeoutMs: workspace.dataSource.statementTimeoutMs,
    maximumRows: workspace.dataSource.maximumRows
  });
  const verified = verifyResult(plan, compiled, execution);
  const answer = composeAnswer(plan, verified, compiled, execution, freshness);
  return { interpretation, plan: serializablePlan(plan), answer };
}

export function interpretOnly({ question, workspace, semanticCatalog = createSeedSemanticCatalog(workspace) }) {
  validateWorkspace(workspace);
  validateSemanticCatalog(semanticCatalog);
  return interpretQuestion(question, workspace, semanticCatalog);
}

function serializablePlan(plan) {
  return {
    intent: plan.intent,
    metricId: plan.metric.id,
    metricVersionId: plan.metricVersion.id,
    metricVersionNumber: plan.metricVersion.versionNumber,
    definitionHash: plan.metricVersion.definitionHash,
    dimension: plan.dimension?.id ?? null,
    current: {
      start: plan.current.start.toISOString(),
      end: plan.current.end.toISOString(),
      label: plan.current.label
    },
    comparison: plan.comparison ? {
      start: plan.comparison.start.toISOString(),
      end: plan.comparison.end.toISOString(),
      label: plan.comparison.label
    } : null,
    timezone: plan.timezone,
    assumptions: plan.ambiguities
  };
}
