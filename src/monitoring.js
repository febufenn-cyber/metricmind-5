import { MetricmindError } from './errors.js';

export const ALERT_KINDS = Object.freeze(['threshold', 'percentage_change', 'missing_data', 'anomaly']);

export function validateMonitoringRule(rule) {
  if (!rule || typeof rule !== 'object' || !rule.id || !rule.organizationId || !rule.name || !rule.question) {
    throw new MetricmindError('INVALID_MONITORING_RULE', 'Monitoring rule ID, organization, name, and question are required.');
  }
  if (!ALERT_KINDS.includes(rule.kind)) throw new MetricmindError('INVALID_ALERT_KIND', 'Alert kind is unsupported.');
  if (!['hourly', 'daily', 'weekly'].includes(rule.cadence)) throw new MetricmindError('INVALID_ALERT_CADENCE', 'Cadence must be hourly, daily, or weekly.');
  if (!Array.isArray(rule.destinations) || rule.destinations.length === 0 || rule.destinations.length > 5) {
    throw new MetricmindError('INVALID_ALERT_DESTINATIONS', 'One to five verified destinations are required.');
  }
  for (const destination of rule.destinations) {
    if (!destination?.id || !['email', 'slack', 'webhook'].includes(destination.type) || destination.verified !== true) {
      throw new MetricmindError('UNVERIFIED_ALERT_DESTINATION', 'Every destination must be verified before use.');
    }
  }
  const cooldownMinutes = Number(rule.cooldownMinutes ?? 60);
  if (!Number.isInteger(cooldownMinutes) || cooldownMinutes < 0 || cooldownMinutes > 10080) {
    throw new MetricmindError('INVALID_ALERT_COOLDOWN', 'Cooldown must be 0 to 10080 minutes.');
  }
  validateCondition(rule);
  return structuredClone({ ...rule, cooldownMinutes, enabled: rule.enabled !== false });
}

export function evaluateAlert(rule, observation, context = {}) {
  const validated = validateMonitoringRule(rule);
  const freshness = context.freshness ?? { status: 'unknown' };
  if (validated.kind !== 'missing_data' && freshness.status !== 'fresh') {
    return {
      status: 'suppressed',
      triggered: false,
      reason: `Business alert suppressed because ingestion freshness is ${freshness.status}.`,
      evidence: { freshness }
    };
  }
  if (isCoolingDown(validated, context.lastTriggeredAt, context.now ?? new Date())) {
    return { status: 'cooldown', triggered: false, reason: 'The rule is inside its configured cooldown window.' };
  }

  let triggered = false;
  let value = null;
  let reason;
  if (validated.kind === 'threshold') {
    value = numeric(observation.value, 'threshold value');
    triggered = compare(value, validated.condition.operator, numeric(validated.condition.value, 'threshold target'));
    reason = `Observed ${value} ${triggered ? 'met' : 'did not meet'} ${validated.condition.operator} ${validated.condition.value}.`;
  } else if (validated.kind === 'percentage_change') {
    value = numeric(observation.percentageChange, 'percentage change');
    triggered = compare(value, validated.condition.operator, numeric(validated.condition.value, 'percentage target'));
    reason = `Observed change ${value}% ${triggered ? 'met' : 'did not meet'} ${validated.condition.operator} ${validated.condition.value}%.`;
  } else if (validated.kind === 'missing_data') {
    const statuses = validated.condition.statuses ?? ['stale', 'error', 'unknown'];
    triggered = statuses.includes(freshness.status);
    value = freshness.ageMinutes ?? null;
    reason = triggered ? `Ingestion freshness is ${freshness.status}.` : `Ingestion freshness is ${freshness.status}; no data-quality alert is required.`;
  } else {
    const values = observation.baselineValues;
    if (!Array.isArray(values) || values.length < 7) throw new MetricmindError('ANOMALY_BASELINE_REQUIRED', 'Anomaly alerts require at least seven baseline values.');
    const clean = values.map((item) => numeric(item, 'baseline value'));
    value = numeric(observation.value, 'anomaly value');
    const mean = clean.reduce((sum, item) => sum + item, 0) / clean.length;
    const variance = clean.reduce((sum, item) => sum + ((item - mean) ** 2), 0) / clean.length;
    const standardDeviation = Math.sqrt(variance);
    const zScore = standardDeviation === 0 ? (value === mean ? 0 : Infinity) : Math.abs((value - mean) / standardDeviation);
    const threshold = numeric(validated.condition.zScore ?? 3, 'z-score threshold');
    triggered = zScore >= threshold;
    reason = `Observed value has a deterministic z-score of ${Number.isFinite(zScore) ? zScore.toFixed(2) : 'infinite'} against ${clean.length} baseline points.`;
    return result(validated, triggered, value, reason, { mean, standardDeviation, zScore, baselineCount: clean.length, freshness });
  }
  return result(validated, triggered, value, reason, { freshness });
}

export function monitoringWindow(rule, now = new Date()) {
  const date = new Date(now);
  date.setUTCMinutes(0, 0, 0);
  if (rule.cadence === 'daily') date.setUTCHours(0);
  if (rule.cadence === 'weekly') {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    date.setUTCHours(0);
  }
  return { start: date.toISOString(), idempotencyKey: `${rule.id}:${date.toISOString()}` };
}

export function composeMonitoringBrief(records, generatedAt = new Date()) {
  const items = records.map((record) => ({
    ruleId: record.ruleId,
    name: record.name,
    status: record.evaluation.status,
    triggered: record.evaluation.triggered,
    statement: record.evaluation.reason,
    evidenceId: record.evidenceId
  }));
  return {
    generatedAt: generatedAt.toISOString(),
    causalStatus: 'not_established',
    summary: {
      total: items.length,
      triggered: items.filter((item) => item.triggered).length,
      suppressed: items.filter((item) => item.status === 'suppressed').length
    },
    items,
    note: 'Alerts report deterministic observations and do not establish causation.'
  };
}

function validateCondition(rule) {
  const condition = rule.condition ?? {};
  if (rule.kind === 'threshold' || rule.kind === 'percentage_change') {
    if (!['greater_than', 'greater_or_equal', 'less_than', 'less_or_equal'].includes(condition.operator)) {
      throw new MetricmindError('INVALID_ALERT_OPERATOR', 'Alert comparison operator is invalid.');
    }
    numeric(condition.value, 'condition value');
  }
  if (rule.kind === 'anomaly') {
    const score = numeric(condition.zScore ?? 3, 'z-score threshold');
    if (score < 1 || score > 10) throw new MetricmindError('INVALID_ANOMALY_THRESHOLD', 'Anomaly z-score must be between 1 and 10.');
  }
}
function isCoolingDown(rule, lastTriggeredAt, now) {
  if (!lastTriggeredAt || rule.cooldownMinutes === 0) return false;
  return now.getTime() - new Date(lastTriggeredAt).getTime() < rule.cooldownMinutes * 60000;
}
function compare(left, operator, right) {
  if (operator === 'greater_than') return left > right;
  if (operator === 'greater_or_equal') return left >= right;
  if (operator === 'less_than') return left < right;
  return left <= right;
}
function result(rule, triggered, value, reason, evidence) {
  return { status: triggered ? 'triggered' : 'not_triggered', triggered, value, reason, ruleId: rule.id, evidence };
}
function numeric(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new MetricmindError('INVALID_ALERT_NUMBER', `${label} must be numeric.`);
  return parsed;
}
