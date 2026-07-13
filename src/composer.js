function formatNumber(value) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value) {
  return new Intl.NumberFormat('en-IN', { style: 'percent', maximumFractionDigits: 1 }).format(value);
}

function formatDate(date, timezone) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    year: 'numeric', month: 'short', day: 'numeric'
  }).format(date);
}

export function composeAnswer(plan, verified, compiled, execution, freshness = { status: 'unknown', warning: null }) {
  const ratio = compiled.valueKind === 'ratio';
  const evidence = {
    metric: {
      id: plan.metric.id,
      name: plan.metric.name,
      definition: plan.metric.description,
      status: 'verified'
    },
    metricVersion: {
      id: plan.metricVersion.id,
      number: plan.metricVersion.versionNumber,
      status: plan.metricVersion.status,
      definitionHash: plan.metricVersion.definitionHash,
      historyPolicy: plan.metricVersion.definition.historyPolicy
    },
    semanticLineage: compiled.semanticLineage,
    timezone: plan.timezone,
    currentPeriod: {
      start: plan.current.start.toISOString(),
      end: plan.current.end.toISOString(),
      label: plan.current.label
    },
    comparisonPeriod: plan.comparison ? {
      start: plan.comparison.start.toISOString(),
      end: plan.comparison.end.toISOString(),
      label: plan.comparison.label
    } : null,
    sql: compiled.sql,
    parameters: redactParameters(compiled.params),
    execution: { durationMs: execution.durationMs, rowCount: execution.rows.length },
    assumptions: plan.ambiguities,
    freshness
  };

  if (verified.kind === 'single_value') {
    const value = ratio ? formatPercent(verified.value) : formatNumber(verified.value);
    return {
      headline: ratio ? `${plan.metric.name}: ${value}` : `${value} ${plan.metric.name.toLowerCase()} records`,
      narrative: `${plan.metric.name} was ${value} from ${formatDate(plan.current.start, plan.timezone)} through the last complete boundary on ${formatDate(plan.current.end, plan.timezone)}.`,
      confidence: freshness.status === 'stale' ? 'medium' : 'high',
      chart: { type: 'metric', value: verified.value, label: plan.metric.name, format: ratio ? 'percentage' : 'number' },
      evidence,
      suggestedActions: ['Show the daily trend', 'Break down by platform', 'Break down by source']
    };
  }

  if (verified.kind === 'period_comparison') {
    const direction = verified.absoluteChange > 0 ? 'increased' : verified.absoluteChange < 0 ? 'decreased' : 'did not change';
    if (ratio) {
      const percentagePoints = Math.abs(verified.absoluteChange * 100);
      return {
        headline: `${plan.metric.name} ${direction}${verified.absoluteChange === 0 ? '' : ` ${percentagePoints.toFixed(1)} percentage points`}`,
        narrative: `${plan.metric.name} was ${formatPercent(verified.current)} in the current period versus ${formatPercent(verified.previous)} in the preceding equal period.`,
        confidence: freshness.status === 'stale' ? 'medium' : 'high',
        chart: {
          type: 'comparison_bars',
          format: 'percentage',
          data: [
            { period: 'Previous', value: verified.previous },
            { period: 'Current', value: verified.current }
          ]
        },
        evidence,
        suggestedActions: []
      };
    }

    const percentage = verified.percentageChange === null ? 'not calculable because the previous value was zero' : `${Math.abs(verified.percentageChange).toFixed(1)}%`;
    return {
      headline: `${plan.metric.name} ${direction}${verified.percentageChange === null ? '' : ` ${percentage}`}`,
      narrative: `${plan.metric.name} was ${formatNumber(verified.current)} in the current period versus ${formatNumber(verified.previous)} in the preceding equal period, an absolute change of ${formatNumber(verified.absoluteChange)}.`,
      confidence: freshness.status === 'stale' ? 'medium' : 'high',
      chart: {
        type: 'comparison_bars',
        data: [
          { period: 'Previous', value: verified.previous },
          { period: 'Current', value: verified.current }
        ]
      },
      evidence,
      suggestedActions: ['Break down by platform', 'Break down by source', 'Show the daily trend']
    };
  }

  if (verified.kind === 'time_series') {
    return {
      headline: `${plan.metric.name} trend over ${plan.current.label.toLowerCase()}`,
      narrative: `${verified.points.length} complete daily points were returned. Metricmind is reporting the observed series only and is not making a causal claim.`,
      confidence: freshness.status === 'stale' ? 'medium' : 'high',
      chart: { type: 'line', data: verified.points, x: 'bucket', y: 'value' },
      evidence,
      suggestedActions: ['Compare with the preceding period', 'Break down by platform']
    };
  }

  const top = verified.segments[0];
  return {
    headline: top ? `${top.segment} is the leading ${plan.dimension.id} segment` : `No ${plan.dimension.id} segments found`,
    narrative: top ? `${top.segment} contributed ${formatNumber(top.value)} ${plan.metric.name.toLowerCase()} records in the selected complete period.` : 'The selected period returned no aggregate segment rows.',
    confidence: freshness.status === 'stale' ? 'medium' : 'high',
    chart: { type: 'bar', data: verified.segments, x: 'segment', y: 'value' },
    evidence,
    suggestedActions: ['Compare with the preceding period', 'Show the daily trend']
  };
}

function redactParameters(params) {
  return params.map((value) => Array.isArray(value) ? `[${value.length} values]` : String(value));
}
