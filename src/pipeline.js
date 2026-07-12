import { validateWorkspace } from './config.js';
import { interpretQuestion } from './interpreter.js';
import { buildQueryPlan } from './planner.js';
import { compileQuery } from './compiler.js';
import { assertSafeSql } from './sql-policy.js';
import { verifyResult } from './verifier.js';
import { composeAnswer } from './composer.js';

export async function answerQuestion({ question, workspace, executor, now = new Date(), freshness = { status: 'unknown', warning: null } }) {
  validateWorkspace(workspace);
  const interpretation = interpretQuestion(question, workspace);
  const plan = buildQueryPlan(interpretation, workspace, now);
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

export function interpretOnly({ question, workspace }) {
  validateWorkspace(workspace);
  return interpretQuestion(question, workspace);
}

function serializablePlan(plan) {
  return {
    intent: plan.intent,
    metricId: plan.metric.id,
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
