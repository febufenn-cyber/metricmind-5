import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkspace } from '../src/config.js';
import { createSeedSemanticCatalog } from '../src/semantic-catalog.js';
import { PostgresSemanticStore, PostgresInvestigationStore } from '../src/metadata-store.js';

class FakeMetadataDb {
  constructor() { this.catalog = null; this.revision = null; this.investigations = new Map(); }
  async query(sql, params) {
    if (sql.includes('INSERT INTO public.semantic_catalog_snapshots')) {
      if (!this.catalog) { this.catalog = JSON.parse(params[1]); this.revision = 1; }
      return { rows: [] };
    }
    if (sql.startsWith('SELECT revision')) return { rows: this.catalog ? [{ revision: this.revision, catalog: this.catalog }] : [] };
    if (sql.includes('UPDATE public.semantic_catalog_snapshots')) {
      if (Number(params[2]) !== this.revision) return { rows: [] };
      this.catalog = JSON.parse(params[1]); this.revision += 1;
      return { rows: [{ revision: this.revision, catalog: this.catalog }] };
    }
    if (sql.includes('INSERT INTO public.investigation_records')) {
      const record = JSON.parse(params[4]); this.investigations.set(`${params[1]}:${params[0]}`, record); return { rows: [{ record }] };
    }
    if (sql.includes('UPDATE public.investigation_records')) {
      const key = `${params[0]}:${params[1]}`; if (!this.investigations.has(key)) return { rows: [] };
      const record = JSON.parse(params[2]); this.investigations.set(key, record); return { rows: [{ record }] };
    }
    if (sql.includes('WHERE organization_id = $1::uuid AND id = $2')) {
      const record = this.investigations.get(`${params[0]}:${params[1]}`); return { rows: record ? [{ record }] : [] };
    }
    if (sql.includes('FROM public.investigation_records')) {
      return { rows: [...this.investigations.values()].filter((record) => record.organizationId === params[0]).map((record) => ({ record })) };
    }
    return { rows: [] };
  }
}

function investigation(id, organizationId) {
  return { id, organizationId, status: 'completed', question: 'Why?', metric: { id: 'signup', versionId: 'signup-v1', definitionHash: 'fnv1a64:test' }, observations: [], hypotheses: [], evidence: [], causalStatus: 'not_established', createdAt: new Date().toISOString() };
}

test('Postgres semantic store enforces optimistic revisions', async () => {
  const db = new FakeMetadataDb();
  const catalog = createSeedSemanticCatalog(defaultWorkspace);
  const store = new PostgresSemanticStore(db, catalog);
  const loaded = await store.load(catalog.organizationId);
  assert.equal(loaded.revision, 1);
  const saved = await store.save(catalog.organizationId, loaded.catalog, { expectedRevision: 1 });
  assert.equal(saved.revision, 2);
  await assert.rejects(() => store.save(catalog.organizationId, loaded.catalog, { expectedRevision: 1 }), (error) => error.code === 'SEMANTIC_REVISION_CONFLICT');
});

test('Postgres investigation store isolates organization keys', async () => {
  const db = new FakeMetadataDb();
  const store = new PostgresInvestigationStore(db);
  const organizationId = '00000000-0000-0000-0000-000000000001';
  await store.save(organizationId, investigation('inv-1', organizationId));
  assert.equal((await store.get(organizationId, 'inv-1')).id, 'inv-1');
  assert.equal(await store.get('00000000-0000-0000-0000-000000000002', 'inv-1'), null);
});
