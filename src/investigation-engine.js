import { MetricmindError } from './errors.js';
import { compileQuery } from './compiler.js';
import { compileInvestigationBreakdown } from './investigation-compiler.js';
import { buildInvestigationPlan } from './investigation-planner.js';
import { assertSafeSql } from './sql-policy.js';
import { verifyResult } from './verifier.js';

export async function runInvestigation({
  question,
  workspace,
  semanticCatalog,
  executor,
  now = new Date(),
  freshness = { status: 'unknown', warning: null },
  semanticHealth = { status: 'unknown', metrics: [] },
  dimensionIds,
  maxDimensions = 4
}) {
  const investigationPlan = buildInvestigationPlan({
    question,
    workspace,
    semanticCatalog,
    now,
    dimensionIds,
    maxDimensions
  });
  const metricHealth = semanticHealth.metrics?.find((item) => item.metricId === investigationPlan.baselinePlan.metric.id) ?? null;
  if (metricHealth?.status === 'invalid') {
    throw new MetricmindError(
      'INVESTIGATION_METRIC_UNHEALTHY',
      'The selected metric has invalid semantic or schema dependencies and cannot be investigated safely.',
      { metricHealth },
      409
    );
  }

  const baselineCompiled = compileQuery(investigationPlan.baselinePlan, workspace);
  assertSafeSql(baselineCompiled, workspace);
  const baselineExecution = await execute(executor, baselineCompiled, investigationPlan.baselinePlan, workspace);
  const baseline = verifyResult(investigationPlan.baselinePlan, baselineCompiled, baselineExecution);
  if (baseline.kind !== 'period_comparison') {
    throw new MetricmindError('INVALID_INVESTIGATION_BASELINE', 'An investigation requires current and previous period values.');
  }

  const breakdowns = [];
  for (const dimension of investigationPlan.dimensions) {
    const compiled = compileInvestigationBreakdown(investigationPlan.baselinePlan, dimension, workspace);
    assertSafeSql(compiled, workspace);
    const execution = await execute(executor, compiled, investigationPlan.baselinePlan, workspace);
    const segments = verifyBreakdownRows(execution.rows, baseline);
    breakdowns.push({
      dimension: { id: dimension.id, name: dimension.name },
      segments,
      reconciliation: reconcileBreakdown(segments, baseline, investigationPlan.baselinePlan.metricVersion.definition.aggregation.type),
      evidence: evidenceForQuery(compiled, execution)
    });
  }

  return composeInvestigation({
    investigationPlan,
    baseline,
    baselineEvidence: evidenceForQuery(baselineCompiled, baselineExecution),
    breakdowns,
    freshness,
    semanticHealth,
    metricHealth,
    now
  });
}

async function execute(executor, compiled, plan, workspace) {
  return executor.query({
    ...compiled,
    plan,
    statementTimeoutMs: workspace.dataSource.statementTimeoutMs,
    maximumRows: workspace.dataSource.maximumRows
  });
}

function verifyBreakdownRows(rows, baseline) {
  if (!Array.isArray(rows)) throw new MetricmindError('INVALID_BREAKDOWN_RESULT', 'Investigation breakdown rows are missing.');
  const segments = rows.map((row) => {
    const current = nonNegative(row.current_value);
    const previous = nonNegative(row.previous_value);
    const absoluteChange = current - previous;
    return {
      segment: String(row.segment ?? 'Unknown'),
      current,
      previous,
      absoluteChange,
      percentageChange: previous === 0 ? null : (absoluteChange / previous) * 100,
      contributionToNetChange: baseline.absoluteChange === 0 ? null : (absoluteChange / baseline.absoluteChange) * 100,
      absoluteMovement: Math.abs(absoluteChange)
    };
  }).sort((left, right) => right.absoluteMovement - left.absoluteMovement || left.segment.localeCompare(right.segment));
  const totalMovement = segments.reduce((sum, segment) => sum + segment.absoluteMovement, 0);
  return segments.map((segment) => ({
    ...segment,
    shareOfAbsoluteMovement: totalMovement === 0 ? 0 : (segment.absoluteMovement / totalMovement) * 100
  }));
}

function reconcileBreakdown(segments, baseline, aggregationType) {
  const summedCurrent = segments.reduce((sum, segment) => sum + segment.current, 0);
  const summedPrevious = segments.reduce((sum, segment) => sum + segment.previous, 0);
  return {
    additive: aggregationType === 'event_count',
    summedCurrent,
    summedPrevious,
    baselineCurrent: baseline.current,
    baselinePrevious: baseline.previous,
    currentGap: summedCurrent - baseline.current,
    previousGap: summedPrevious - baseline.previous,
    note: aggregationType === 'event_count'
      ? 'Event-count segments are expected to reconcile when each event has one dimension value.'
      : 'Distinct entities may appear in multiple segments, so segment totals are not assumed to reconcile to the baseline.'
  };
}

function composeInvestigation({ investigationPlan, baseline, baselineEvidence, breakdowns, freshness, semanticHealth, metricHealth, now }) {
  const evidence = [{
    id: 'baseline',
    type: 'metric_comparison',
    finding: baseline,
    query: baselineEvidence
  }];
  for (const breakdown of breakdowns) {
    evidence.push({
      id: `dimension:${breakdown.dimension.id}`,
      type: 'segment_decomposition',
      dimension: breakdown.dimension,
      finding: { segments: breakdown.segments, reconciliation: breakdown.reconciliation },
      query: breakdown.evidence
    });
  }
  if (freshness.status !== 'unknown') {
    evidence.push({ id: 'data-quality:freshness', type: 'data_quality', finding: freshness });
  }
  if (metricHealth) {
    evidence.push({ id: 'data-quality:semantic-health', type: 'data_quality', finding: metricHealth });
  }
  const observations = buildObservations(baseline, breakdowns, freshness, metricHealth);
  const hypotheses = buildHypotheses(baseline, breakdowns, freshness, metricHealth);
  const confidence = investigationConfidence({ baseline, freshness, metricHealth, breakdowns });
  const direction = baseline.absoluteChange > 0 ? 'increased' : baseline.absoluteChange < 0 ? 'decreased' : 'did not change';

  return {
    id: `investigation-${investigationPlan.baselinePlan.metric.id}-${now.getTime()}`,
    status: baseline.absoluteChange === 0 ? 'no_change' : freshness.status === 'stale' || metricHealth?.status === 'warning' ? 'limited' : 'completed',
    question: investigationPlan.question,
    metric: {
      id: investigationPlan.baselinePlan.metric.id,
      name: investigationPlan.baselinePlan.metric.name,
      versionId: investigationPlan.baselinePlan.metricVersion.id,
      versionNumber: investigationPlan.baselinePlan.metricVersion.versionNumber,
      definitionHash: investigationPlan.baselinePlan.metricVersion.definitionHash
    },
    headline: `${investigationPlan.baselinePlan.metric.name} ${direction}${baseline.percentageChange === null ? '' : ` ${Math.abs(baseline.percentageChange).toFixed(1)}%`}`,
    baseline,
    periods: {
      current: serializePeriod(investigationPlan.baselinePlan.current),
      previous: serializePeriod(investigationPlan.baselinePlan.comparison),
      timezone: investigationPlan.baselinePlan.timezone
    },
    dataQuality: {
      freshness,
      semanticHealth: metricHealth ?? { status: semanticHealth.status ?? 'unknown' }
    },
    observations,
    hypotheses,
    evidence,
    confidence,
    causalStatus: 'not_established',
    nextChecks: nextChecks(breakdowns, freshness),
    warnings: investigationPlan.warnings,
    limits: investigationPlan.limits,
    createdAt: now.toISOString()
  };
}

function buildObservations(baseline, breakdowns, freshness, metricHealth) {
  const observations = [{
    id: 'observation:baseline',
    evidenceIds: ['baseline'],
    statement: `The metric changed from ${baseline.previous} to ${baseline.current}, an absolute change of ${baseline.absoluteChange}.`,
    classification: 'observed'
  }];
  for (const breakdown of breakdowns) {
    const top = breakdown.segments[0];
    if (!top) continue;
    observations.push({
      id: `observation:${breakdown.dimension.id}:top-movement`,
      evidenceIds: [`dimension:${breakdown.dimension.id}`],
      statement: `${breakdown.dimension.name}=${top.segment} had the largest absolute movement (${top.absoluteChange >= 0 ? '+' : ''}${top.absoluteChange}).`,
      classification: 'observed'
    });
  }
  if (freshness.status === 'stale') {
    observations.push({
      id: 'observation:data-stale',
      evidenceIds: ['data-quality:freshness'],
      statement: freshness.warning ?? 'Warehouse ingestion is stale.',
      classification: 'data_quality'
    });
  }
  if (metricHealth?.status === 'warning') {
    observations.push({
      id: 'observation:semantic-warning',
      evidenceIds: ['data-quality:semantic-health'],
      statement: (metricHealth.warnings ?? []).join(' ') || 'The metric has semantic health warnings.',
      classification: 'data_quality'
    });
  }
  return observations;
}

function buildHypotheses(baseline, breakdowns, freshness, metricHealth) {
  const hypotheses = [];
  if (freshness.status === 'stale') {
    hypotheses.push({
      id: 'hypothesis:data-delay',
      statement: 'Ingestion delay could distort part or all of the observed comparison.',
      type: 'data_quality',
      evidenceStrength: 'moderate',
      evidenceIds: ['data-quality:freshness'],
      contradictions: ['A stale timestamp does not prove the metric change is caused by ingestion delay.'],
      causalStatus: 'not_established'
    });
  }
  if (metricHealth?.status === 'warning') {
    hypotheses.push({
      id: 'hypothesis:semantic-warning',
      statement: 'A semantic dependency warning may reduce confidence in the observed change.',
      type: 'data_quality',
      evidenceStrength: 'low',
      evidenceIds: ['data-quality:semantic-health'],
      contradictions: ['The query executed successfully and the warning may not affect this period.'],
      causalStatus: 'not_established'
    });
  }
  if (baseline.absoluteChange === 0) {
    hypotheses.push({
      id: 'hypothesis:no-net-change',
      statement: 'No net metric change was observed between the two complete periods, so root-cause investigation is not warranted.',
      type: 'insufficient_evidence',
      evidenceStrength: 'none',
      evidenceIds: ['baseline'],
      contradictions: [],
      causalStatus: 'not_established'
    });
    return hypotheses.slice(0, 6);
  }
  for (const breakdown of breakdowns) {
    const top = breakdown.segments[0];
    if (!top || top.absoluteMovement === 0) continue;
    const direction = Math.sign(baseline.absoluteChange);
    const aligned = breakdown.segments.filter((segment) => Math.sign(segment.absoluteChange) === direction);
    const topAligned = aligned[0] ?? null;
    const opposite = breakdown.segments.filter((segment) => Math.sign(segment.absoluteChange) !== 0 && Math.sign(segment.absoluteChange) !== direction);
    if (topAligned && topAligned.shareOfAbsoluteMovement >= 50) {
      hypotheses.push({
        id: `hypothesis:${breakdown.dimension.id}:concentration`,
        statement: `The observed change is concentrated in ${breakdown.dimension.name}=${topAligned.segment}, which accounts for ${topAligned.shareOfAbsoluteMovement.toFixed(1)}% of absolute segment movement in the same direction as the baseline.`,
        type: 'association',
        evidenceStrength: topAligned.shareOfAbsoluteMovement >= 70 ? 'strong' : 'moderate',
        evidenceIds: [`dimension:${breakdown.dimension.id}`],
        contradictions: opposite.slice(0, 3).map((segment) => `${segment.segment} moved in the opposite direction (${segment.absoluteChange >= 0 ? '+' : ''}${segment.absoluteChange}).`),
        causalStatus: 'not_established'
      });
    } else if (breakdown.segments.length >= 3 && top.shareOfAbsoluteMovement < 35) {
      hypotheses.push({
        id: `hypothesis:${breakdown.dimension.id}:broad`,
        statement: `The movement is broad across ${breakdown.dimension.name} rather than dominated by one segment.`,
        type: 'association',
        evidenceStrength: 'moderate',
        evidenceIds: [`dimension:${breakdown.dimension.id}`],
        contradictions: [],
        causalStatus: 'not_established'
      });
    }
  }
  if (hypotheses.length === 0) {
    hypotheses.push({
      id: 'hypothesis:insufficient-segmentation',
      statement: 'The available aggregate decompositions do not isolate a dominant associated segment.',
      type: 'insufficient_evidence',
      evidenceStrength: 'low',
      evidenceIds: breakdowns.map((item) => `dimension:${item.dimension.id}`),
      contradictions: [],
      causalStatus: 'not_established'
    });
  }
  return hypotheses.slice(0, 6);
}

function investigationConfidence({ baseline, freshness, metricHealth, breakdowns }) {
  if (freshness.status === 'stale') return { level: 'low', score: 0.45, reason: 'Warehouse freshness is outside the configured threshold.' };
  if (freshness.status === 'unknown') return { level: 'medium', score: 0.6, reason: 'Warehouse freshness could not be verified.' };
  if (metricHealth?.status === 'warning') return { level: 'medium', score: 0.65, reason: 'The metric has semantic health warnings.' };
  if (baseline.previous === 0) return { level: 'medium', score: 0.68, reason: 'Percentage change is undefined because the previous value was zero.' };
  if (breakdowns.length === 0) return { level: 'medium', score: 0.7, reason: 'The baseline is verified, but no segment decomposition was available.' };
  return { level: 'high', score: 0.88, reason: 'The baseline and approved aggregate decompositions completed with healthy data checks.' };
}

function nextChecks(breakdowns, freshness) {
  const checks = [];
  if (freshness.status !== 'fresh') checks.push('Verify warehouse ingestion and late-arriving events before acting on the result.');
  const top = breakdowns.map((item) => ({ dimension: item.dimension, segment: item.segments[0] })).find((item) => item.segment);
  if (top) checks.push(`Review product releases, campaigns, and operational changes affecting ${top.dimension.name}=${top.segment.segment}.`);
  checks.push('Compare the affected segment in the next downstream funnel step.');
  checks.push('Review release, incident, pricing, and acquisition timelines for the same complete period.');
  checks.push('Run a controlled experiment or obtain external evidence before making a causal claim.');
  return checks;
}

function evidenceForQuery(compiled, execution) {
  return {
    sql: compiled.sql,
    parameters: compiled.params.map((value) => String(value)),
    durationMs: execution.durationMs,
    rowCount: execution.rows.length,
    semanticLineage: compiled.semanticLineage
  };
}

function serializePeriod(period) {
  return { start: period.start.toISOString(), end: period.end.toISOString(), label: period.label };
}

function nonNegative(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new MetricmindError('INVALID_BREAKDOWN_VALUE', `Invalid investigation aggregate value: ${String(value)}`);
  }
  return parsed;
}
