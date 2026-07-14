import { answerQuestion } from './pipeline.js';
import { workspaceFromEnv } from './worker.js';
import { createWarehouseExecutor } from './executor.js';
import { getDataSourceFreshness } from './data-source.js';
import { createSemanticStore } from './semantic-store.js';
import { createMonitoringStore } from './monitoring-store.js';
import { composeMonitoringBrief, evaluateAlert, monitoringWindow } from './monitoring.js';
import { deliverNotification, notificationMessage } from './notifications.js';

export async function runMonitoringSchedules(env = {}, now = new Date()) {
  const store = createMonitoringStore(env);
  if (store.mode === 'ephemeral' && env.ALLOW_EPHEMERAL_SCHEDULES !== 'true') {
    return { status: 'skipped', reason: 'Durable monitoring storage is required for scheduled execution.', processed: 0 };
  }
  const rules = await store.listDue(now);
  const records = [];
  for (const rule of rules) {
    const window = monitoringWindow(rule, now);
    if (!await store.claim(rule.id, window.idempotencyKey)) continue;
    const record = await runRule(rule, window, store, env, now);
    records.push(record);
  }
  return { status: 'completed', persistence: store.mode, processed: records.length, brief: composeMonitoringBrief(records, now), records };
}

async function runRule(rule, window, store, env, now) {
  const workspace = workspaceFromEnv(env, rule.organizationId);
  const semanticStore = createSemanticStore(env, workspace);
  const snapshot = await semanticStore.load(rule.organizationId);
  const executor = createWarehouseExecutor(env);
  const freshness = await getDataSourceFreshness({ executor, workspace, now });
  let answer = null;
  let observation = {};
  if (rule.kind !== 'missing_data' || freshness.status === 'fresh') {
    const response = await answerQuestion({ question: rule.question, workspace, semanticCatalog: snapshot.catalog, executor, now, freshness });
    answer = response.answer;
    observation = observationFromAnswer(answer, rule);
  }
  const latest = await store.latestTriggered(rule.id);
  const evaluation = evaluateAlert(rule, observation, { freshness, lastTriggeredAt: latest?.completedAt, now });
  const evidenceId = `monitoring:${rule.id}:${window.start}`;
  const record = {
    id: evidenceId,
    ruleId: rule.id,
    organizationId: rule.organizationId,
    name: rule.name,
    window,
    status: 'completed',
    evaluation,
    evidenceId,
    answerEvidence: answer?.evidence ?? null,
    completedAt: now.toISOString()
  };
  const deliveries = [];
  if (evaluation.triggered) {
    for (const destination of rule.destinations) {
      const result = await deliverNotification(destination, notificationMessage(rule, evaluation, answer, record), env, { idempotencyKey: `${window.idempotencyKey}:${destination.id}` });
      const delivery = { organizationId: rule.organizationId, ruleId: rule.id, destinationId: destination.id, destinationType: destination.type, ...result, createdAt: now.toISOString() };
      deliveries.push(await store.recordDelivery(delivery));
    }
  }
  record.deliveries = deliveries;
  await store.complete(rule.id, window.idempotencyKey, record);
  return record;
}

export function observationFromAnswer(answer, rule) {
  const chart = answer?.chart;
  if (rule.kind === 'percentage_change') {
    const data = chart?.data ?? [];
    const previous = Number(data.find((item) => item.period === 'Previous')?.value);
    const current = Number(data.find((item) => item.period === 'Current')?.value);
    return { previous, current, percentageChange: previous === 0 ? null : ((current - previous) / previous) * 100 };
  }
  if (rule.kind === 'anomaly') {
    const points = chart?.data ?? [];
    return { value: Number(points.at(-1)?.value), baselineValues: points.slice(0, -1).map((item) => Number(item.value)) };
  }
  return { value: Number(chart?.value ?? chart?.data?.at(-1)?.value) };
}
