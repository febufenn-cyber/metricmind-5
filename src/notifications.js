import { MetricmindError } from './errors.js';

export async function deliverNotification(destination, message, env = {}, options = {}) {
  if (!destination?.id || destination.verified !== true) throw new MetricmindError('UNVERIFIED_ALERT_DESTINATION', 'Notification destination must be verified.');
  const adapter = destination.type === 'email' ? env.EMAIL_NOTIFIER : destination.type === 'slack' ? env.SLACK_NOTIFIER : env.WEBHOOK_NOTIFIER;
  if (typeof adapter?.send !== 'function') {
    throw new MetricmindError('NOTIFICATION_ADAPTER_NOT_CONFIGURED', `${destination.type} notification adapter is not configured.`, undefined, 503);
  }
  const attempts = Math.min(3, Math.max(1, Number(options.attempts ?? 3)));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await adapter.send({
        destinationId: destination.id,
        message: structuredClone(message),
        idempotencyKey: options.idempotencyKey,
        attempt
      });
      return { status: 'delivered', attempt, providerReference: result?.id ?? null };
    } catch (error) {
      lastError = error;
    }
  }
  return { status: 'dead_letter', attempt: attempts, errorCode: classify(lastError) };
}

export function notificationMessage(rule, evaluation, answer, briefItem) {
  return {
    title: `${evaluation.triggered ? 'Alert' : 'Update'}: ${rule.name}`,
    statement: evaluation.reason,
    question: rule.question,
    observedValue: evaluation.value,
    causalStatus: 'not_established',
    evidence: answer?.evidence ?? null,
    evidenceId: briefItem.evidenceId,
    generatedAt: new Date().toISOString()
  };
}

function classify(error) {
  if (error?.code === 'RATE_LIMITED') return 'rate_limited';
  if (error?.code === 'DESTINATION_REVOKED') return 'destination_revoked';
  return 'delivery_failed';
}
