function formatNumber(value) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value);
}

function formatDate(date, timezone) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    year: 'numeric', month: 'short', day: 'numeric'
  }).format(date);
}

export function composeAnswer(plan, verified, compiled, execution, freshness = { status: 'unknown', warning: null }) {
  const evidence = {
    metric: {
      id: plan.metric.id,
      name: plan.metric.name,
      definition: plan.metric.description,
      status: plan.metric.status
    },
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
    return {
      headline: `${formatNumber(verified.value)} ${plan.metric.name.toLowerCase()} records`,
      narrative: `${plan.metric.name} was ${formatNumber(verified.value)} from ${formatDate(plan.current.start, plan.timezone)} through the last complete boundary on ${formatDate(plan.current.end, plan.timezone)}.`,
      confidence: 'high',
      chart: { type: 'metric', value: verified.value, label: plan.metric.name },
      evidence,
      suggestedActions: ['Show the daily trend', 'Break down by platform', 'Break down by source']
    };
  }

  if (verified.kind === 'period_comparison') {
    const direction = verified.absoluteChange > 0 ? 'increased' : verified.absoluteChange < 0 ? 'decreased' : 'did not change';
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
      confidence: 'high',
      chart: { type: 'line', data: verified.points, x: 'bucket', y: 'value' },
      evidence,
      suggestedActions: ['Compare with the preceding period', 'Break down by platform']
    };
  }

  const top = verified.segments[0];
  return {
    headline: top ? `${top.segment} is the leading ${plan.dimension.id} segment` : `No ${plan.dimension.id} segments found`,
    narrative: top ? `${top.segment} contributed ${formatNumber(top.value)} ${plan.metric.name.toLowerCase()} records in the selected complete period.` : 'The selected period returned no aggregate segment rows.',
    confidence: 'high',
    chart: { type: 'bar', data: verified.segments, x: 'segment', y: 'value' },
    evidence,
    suggestedActions: ['Compare with the preceding period', 'Show the daily trend']
  };
}

function redactParameters(params) {
  return params.map((value, index) => index === 0 ? value : String(value));
}
