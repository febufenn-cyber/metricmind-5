import { MetricmindError } from './errors.js';

const processRecords = new Map();

export function createInvestigationStore(env = {}) {
  if (env.INVESTIGATION_STORE) {
    return new BindingInvestigationStore(env.INVESTIGATION_STORE);
  }
  return new MemoryInvestigationStore(processRecords, 'ephemeral');
}

export class MemoryInvestigationStore {
  constructor(records = new Map(), mode = 'memory') {
    this.records = records;
    this.mode = mode;
  }

  async save(organizationId, investigation) {
    const record = validateInvestigationRecord({ ...structuredClone(investigation), organizationId });
    const key = recordKey(organizationId, record.id);
    if (this.records.has(key)) {
      throw new MetricmindError('INVESTIGATION_ALREADY_EXISTS', 'An investigation with this ID already exists.', undefined, 409);
    }
    this.records.set(key, structuredClone(record));
    return structuredClone(record);
  }

  async get(organizationId, investigationId) {
    const record = this.records.get(recordKey(organizationId, investigationId));
    return record ? structuredClone(record) : null;
  }

  async list(organizationId, options = {}) {
    const limit = boundedListLimit(options.limit ?? 20);
    const metricId = options.metricId ? String(options.metricId) : null;
    return [...this.records.values()]
      .filter((record) => record.organizationId === organizationId && (!metricId || record.metric.id === metricId))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }
}

class BindingInvestigationStore {
  constructor(binding) {
    for (const method of ['save', 'get', 'list']) {
      if (typeof binding?.[method] !== 'function') {
        throw new MetricmindError('INVALID_INVESTIGATION_STORE', `INVESTIGATION_STORE must implement ${method}().`, undefined, 500);
      }
    }
    this.binding = binding;
    this.mode = 'persistent';
  }

  async save(organizationId, investigation) {
    const record = validateInvestigationRecord({ ...structuredClone(investigation), organizationId });
    const saved = await this.binding.save(organizationId, record);
    return validateInvestigationRecord(saved ?? record);
  }

  async get(organizationId, investigationId) {
    const record = await this.binding.get(organizationId, investigationId);
    return record ? validateInvestigationRecord(record) : null;
  }

  async list(organizationId, options = {}) {
    const safeOptions = { ...options, limit: boundedListLimit(options.limit ?? 20) };
    const records = await this.binding.list(organizationId, safeOptions);
    if (!Array.isArray(records)) {
      throw new MetricmindError('INVALID_INVESTIGATION_STORE_RESPONSE', 'Investigation store list() must return an array.', undefined, 502);
    }
    return records.map(validateInvestigationRecord);
  }
}

export function validateInvestigationRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new MetricmindError('INVALID_INVESTIGATION_RECORD', 'Investigation record must be an object.');
  }
  if (!record.id || !record.organizationId || !record.question || !record.createdAt) {
    throw new MetricmindError('INVALID_INVESTIGATION_RECORD', 'Investigation ID, organization, question, and creation time are required.');
  }
  if (!['completed', 'limited'].includes(record.status)) {
    throw new MetricmindError('INVALID_INVESTIGATION_STATUS', 'Stored investigation status is invalid.');
  }
  if (!record.metric?.id || !record.metric?.versionId || !record.metric?.definitionHash) {
    throw new MetricmindError('INVALID_INVESTIGATION_LINEAGE', 'Stored investigations require pinned semantic lineage.');
  }
  if (record.causalStatus !== 'not_established') {
    throw new MetricmindError('INVALID_CAUSAL_STATUS', 'Phase 3 investigations must preserve causalStatus=not_established.');
  }
  if (!Array.isArray(record.evidence) || !Array.isArray(record.hypotheses) || !Array.isArray(record.observations)) {
    throw new MetricmindError('INVALID_INVESTIGATION_EVIDENCE', 'Stored investigations require evidence, hypotheses, and observations arrays.');
  }
  if (Number.isNaN(new Date(record.createdAt).getTime())) {
    throw new MetricmindError('INVALID_INVESTIGATION_TIMESTAMP', 'Investigation createdAt is invalid.');
  }
  return structuredClone(record);
}

function boundedListLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new MetricmindError('INVALID_INVESTIGATION_LIST_LIMIT', 'limit must be an integer between 1 and 100.');
  }
  return parsed;
}

function recordKey(organizationId, investigationId) {
  return `${organizationId}:${investigationId}`;
}
