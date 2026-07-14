import { MetricmindError } from './errors.js';
import { createSeedSemanticCatalog, validateSemanticCatalog } from './semantic-catalog.js';
import { PostgresSemanticStore } from './metadata-store.js';

export class MemorySemanticStore {
  constructor(catalog, revision = 1) {
    validateSemanticCatalog(catalog);
    this.records = new Map([[catalog.organizationId, {
      catalog: structuredClone(catalog),
      revision
    }]]);
    this.mode = 'memory';
  }

  async load(organizationId) {
    const record = this.records.get(organizationId);
    if (!record) throw new MetricmindError('SEMANTIC_CATALOG_NOT_FOUND', 'No semantic catalog exists for this organization.', undefined, 404);
    return structuredClone(record);
  }

  async save(organizationId, catalog, { expectedRevision } = {}) {
    validateSemanticCatalog(catalog);
    if (catalog.organizationId !== organizationId) {
      throw new MetricmindError('SEMANTIC_ORGANIZATION_MISMATCH', 'Semantic catalog organization does not match the store key.');
    }
    const current = this.records.get(organizationId);
    if (!current) throw new MetricmindError('SEMANTIC_CATALOG_NOT_FOUND', 'No semantic catalog exists for this organization.', undefined, 404);
    if (expectedRevision !== current.revision) {
      throw new MetricmindError(
        'SEMANTIC_REVISION_CONFLICT',
        'The semantic catalog changed before this update could be saved.',
        { expectedRevision, currentRevision: current.revision },
        409
      );
    }
    const next = { catalog: structuredClone(catalog), revision: current.revision + 1 };
    this.records.set(organizationId, next);
    return structuredClone(next);
  }
}

export function createSemanticStore(env, workspace) {
  if (env?.SEMANTIC_STORE && typeof env.SEMANTIC_STORE.load === 'function' && typeof env.SEMANTIC_STORE.save === 'function') {
    return env.SEMANTIC_STORE;
  }
  const seed = createSeedSemanticCatalog(workspace);
  if (env?.METADATA_DB) return new PostgresSemanticStore(env.METADATA_DB, seed);
  return new ReadonlySeedSemanticStore(seed);
}

class ReadonlySeedSemanticStore {
  constructor(catalog) {
    this.catalog = catalog;
    this.mode = 'readonly_seed';
  }

  async load(organizationId) {
    if (organizationId !== this.catalog.organizationId) {
      throw new MetricmindError('SEMANTIC_CATALOG_NOT_FOUND', 'No semantic catalog exists for this organization.', undefined, 404);
    }
    return { catalog: structuredClone(this.catalog), revision: 0 };
  }

  async save() {
    throw new MetricmindError(
      'SEMANTIC_STORE_NOT_CONFIGURED',
      'Semantic mutations require a persistent organization-scoped store binding.',
      undefined,
      503
    );
  }
}
