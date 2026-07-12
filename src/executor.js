import { MetricmindError } from './errors.js';
import { createHyperdriveAdapter } from './postgres-adapter.js';

export class BindingQueryExecutor {
  constructor(binding) {
    this.binding = binding;
  }

  async query(request) {
    if (!this.binding || typeof this.binding.query !== 'function') {
      throw new MetricmindError(
        'WAREHOUSE_NOT_CONFIGURED',
        'No Postgres query binding is configured. Bind HYPERDRIVE or ANALYTICS_DB to a read-only query adapter.',
        undefined,
        503
      );
    }

    const startedAt = Date.now();
    try {
      const result = await this.binding.query(request.sql, request.params ?? [], {
        readOnly: true,
        statementTimeoutMs: request.statementTimeoutMs,
        maximumRows: request.maximumRows
      });
      const rows = Array.isArray(result) ? result : result?.rows;
      if (!Array.isArray(rows)) {
        throw new MetricmindError('INVALID_WAREHOUSE_RESPONSE', 'The warehouse adapter returned an invalid result.');
      }
      if (rows.length > request.maximumRows) {
        throw new MetricmindError('RESULT_TOO_LARGE', 'The query returned more rows than permitted.');
      }
      return { rows, durationMs: Date.now() - startedAt };
    } catch (error) {
      if (error instanceof MetricmindError) throw error;
      throw new MetricmindError('WAREHOUSE_QUERY_FAILED', 'The read-only warehouse query failed.', undefined, 502);
    }
  }
}

export function createWarehouseExecutor(env = {}, options = {}) {
  if (env.ANALYTICS_DB && typeof env.ANALYTICS_DB.query === 'function') {
    return new BindingQueryExecutor(env.ANALYTICS_DB);
  }
  const adapter = createHyperdriveAdapter(env.HYPERDRIVE, {
    clientFactory: options.clientFactory,
    applicationName: options.applicationName ?? 'metricmind-phase1b'
  });
  return new BindingQueryExecutor(adapter);
}

export class StaticExecutor {
  constructor(resolver) {
    this.resolver = resolver;
  }

  async query(request) {
    const rows = await this.resolver(request);
    return { rows, durationMs: 1 };
  }
}
