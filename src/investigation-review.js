import { MetricmindError } from './errors.js';
import { validateInvestigationRecord } from './investigation-store.js';

export const INVESTIGATION_REVIEW_DECISIONS = Object.freeze(['accepted', 'rejected', 'inconclusive']);

export function reviewInvestigation(investigation, { decision, note } = {}, actorId, now = new Date()) {
  const candidate = validateInvestigationRecord(investigation);
  const actor = requiredActor(actorId);
  if (!INVESTIGATION_REVIEW_DECISIONS.includes(decision)) {
    throw new MetricmindError('INVALID_INVESTIGATION_REVIEW', 'decision must be accepted, rejected, or inconclusive.');
  }
  const normalizedNote = note === undefined || note === null ? null : String(note).trim();
  if (normalizedNote && normalizedNote.length > 2000) {
    throw new MetricmindError('INVESTIGATION_REVIEW_NOTE_TOO_LONG', 'Investigation review notes are limited to 2,000 characters.');
  }
  const review = {
    id: `review-${candidate.id}-${now.getTime()}`,
    decision,
    note: normalizedNote || null,
    actorId: actor,
    createdAt: now.toISOString()
  };
  candidate.reviewHistory ??= [];
  candidate.reviewHistory.push(review);
  candidate.resolution = review;
  candidate.causalStatus = 'not_established';
  return { investigation: validateInvestigationRecord(candidate), review };
}

function requiredActor(actorId) {
  if (typeof actorId !== 'string' || actorId.trim().length < 2 || actorId.length > 200) {
    throw new MetricmindError('INVESTIGATION_ACTOR_REQUIRED', 'Investigation review requires a valid actor identifier.');
  }
  return actorId.trim();
}
