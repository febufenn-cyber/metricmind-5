import { MetricmindError } from './errors.js';
import { validateSemanticCatalog } from './semantic-catalog.js';
import { validateInvestigationRecord } from './investigation-store.js';

export class PostgresSemanticStore {
  constructor(binding, seedCatalog) {
    assertQueryBinding(binding);
    validateSemanticCatalog(seedCatalog);
    this.binding = binding;
    this.seedCatalog = structuredClone(seedCatalog);
    this.mode = 'persistent';
  }

  async load(organizationId) {
    const seed = structuredClone(this.seedCatalog);
    seed.organizationId = organizationId;
    await query(this.binding,
      `INSERT INTO public.semantic_catalog_snapshots (organization_id, revision, catalog)
       VALUES ($1::uuid, 1, $2::jsonb)
       ON CONFLICT (organization_id) DO NOTHING`,
      [organizationId, JSON.stringify(seed)], false);
    const rows = await query(this.binding,
      'SELECT revision, catalog FROM public.semantic_catalog_snapshots WHERE organization_id = $1::uuid LIMIT 1',
      [organizationId], true);
    const row = rows[0];
    if (!row) throw new MetricmindError('SEMANTIC_CATALOG_NOT_FOUND', 'No semantic catalog exists for this organization.', undefined, 404);
    const catalog = parseJson(row.catalog);
    validateSemanticCatalog(catalog);
    return { revision: Number(row.revision), catalog };
  }

  async save(organizationId, catalog, { expectedRevision } = {}) {
    validateSemanticCatalog(catalog);
    if (catalog.organizationId !== organizationId) {
      throw new MetricmindError('SEMANTIC_ORGANIZATION_MISMATCH', 'Semantic catalog organization does not match the store key.');
    }
    const rows = await query(this.binding,
      `UPDATE public.semantic_catalog_snapshots
       SET catalog = $2::jsonb, revision = revision + 1, updated_at = now()
       WHERE organization_id = $1::uuid AND revision = $3::bigint
       RETURNING revision, catalog`,
      [organizationId, JSON.stringify(catalog), expectedRevision], false);
    if (!rows[0]) {
      throw new MetricmindError('SEMANTIC_REVISION_CONFLICT', 'The semantic catalog changed before this update could be saved.', undefined, 409);
    }
    return { revision: Number(rows[0].revision), catalog: parseJson(rows[0].catalog) };
  }
}

export class PostgresInvestigationStore {
  constructor(binding) {
    assertQueryBinding(binding);
    this.binding = binding;
    this.mode = 'persistent';
  }

  async save(organizationId, investigation) {
    const record = validateInvestigationRecord({ ...structuredClone(investigation), organizationId });
    try {
      const rows = await query(this.binding,
        `INSERT INTO public.investigation_records (id, organization_id, metric_id, created_at, record)
         VALUES ($1, $2::uuid, $3, $4::timestamptz, $5::jsonb)
         RETURNING record`,
        [record.id, organizationId, record.metric.id, record.createdAt, JSON.stringify(record)], false);
      return validateInvestigationRecord(parseJson(rows[0]?.record ?? record));
    } catch (error) {
      if (String(error?.code) === '23505') {
        throw new MetricmindError('INVESTIGATION_ALREADY_EXISTS', 'An investigation with this ID already exists.', undefined, 409);
      }
      throw error;
    }
  }

  async get(organizationId, investigationId) {
    const rows = await query(this.binding,
      'SELECT record FROM public.investigation_records WHERE organization_id = $1::uuid AND id = $2 LIMIT 1',
      [organizationId, investigationId], true);
    return rows[0] ? validateInvestigationRecord(parseJson(rows[0].record)) : null;
  }

  async update(organizationId, investigationId, investigation) {
    const record = validateInvestigationRecord({ ...structuredClone(investigation), organizationId, id: investigationId });
    const rows = await query(this.binding,
      `UPDATE public.investigation_records SET record = $3::jsonb, updated_at = now()
       WHERE organization_id = $1::uuid AND id = $2 RETURNING record`,
      [organizationId, investigationId, JSON.stringify(record)], false);
    if (!rows[0]) throw new MetricmindError('INVESTIGATION_NOT_FOUND', 'Investigation does not exist.', undefined, 404);
    return validateInvestigationRecord(parseJson(rows[0].record));
  }

  async list(organizationId, options = {}) {
    const limit = boundedLimit(options.limit ?? 20);
    const metricId = options.metricId ? String(options.metricId) : null;
    const rows = await query(this.binding,
      `SELECT record FROM public.investigation_records
       WHERE organization_id = $1::uuid AND ($2::text IS NULL OR metric_id = $2)
       ORDER BY created_at DESC LIMIT $3`,
      [organizationId, metricId, limit], true, limit);
    return rows.map((row) => validateInvestigationRecord(parseJson(row.record)));
  }
}

export class PostgresMembershipStore {
  constructor(binding) {
    assertQueryBinding(binding);
    this.binding = binding;
  }

  async getMembership(userId, organizationId) {
    const rows = await query(this.binding,
      'SELECT role, status FROM public.organization_memberships WHERE user_id = $1::uuid AND organization_id = $2::uuid LIMIT 1',
      [userId, organizationId], true, 1);
    return rows[0] ?? null;
  }
}

async function query(binding, sql, params, readOnly, maximumRows = 10) {
  const result = await binding.query(sql, params, { readOnly, statementTimeoutMs: 5000, maximumRows });
  if (!result || !Array.isArray(result.rows)) {
    throw new MetricmindError('INVALID_METADATA_STORE_RESPONSE', 'Metadata database query did not return rows.', undefined, 502);
  }
  return result.rows;
}

function assertQueryBinding(binding) {
  if (typeof binding?.query !== 'function') {
    throw new MetricmindError('METADATA_STORE_NOT_CONFIGURED', 'METADATA_DB must implement query(sql, params, options).', undefined, 503);
  }
}

function parseJson(value) {
  if (typeof value === 'string') return JSON.parse(value);
  return structuredClone(value);
}

function boundedLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new MetricmindError('INVALID_INVESTIGATION_LIST_LIMIT', 'limit must be an integer between 1 and 100.');
  }
  return parsed;
}
