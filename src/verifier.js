import { MetricmindError } from './errors.js';

export function verifyResult(plan, compiled, execution) {
  const rows = execution.rows;
  if (!Array.isArray(rows)) throw new MetricmindError('INVALID_RESULT', 'Warehouse rows are missing.');

  switch (compiled.expectedShape) {
    case 'single_value': {
      if (rows.length !== 1) throw new MetricmindError('UNEXPECTED_RESULT_SHAPE', 'Expected exactly one aggregate row.');
      return { kind: 'single_value', value: number(rows[0].value) };
    }
    case 'time_series':
      return {
        kind: 'time_series',
        points: rows.map((row) => ({ bucket: new Date(row.bucket).toISOString(), value: number(row.value) }))
      };
    case 'segmentation':
      return {
        kind: 'segmentation',
        segments: rows.map((row) => ({ segment: String(row.segment), value: number(row.value) }))
      };
    case 'period_comparison': {
      const values = Object.fromEntries(rows.map((row) => [String(row.period), number(row.value)]));
      if (!Number.isFinite(values.current) || !Number.isFinite(values.previous)) {
        throw new MetricmindError('INCOMPLETE_COMPARISON', 'Both current and previous periods are required.');
      }
      const absoluteChange = values.current - values.previous;
      const percentageChange = values.previous === 0 ? null : (absoluteChange / values.previous) * 100;
      return {
        kind: 'period_comparison',
        current: values.current,
        previous: values.previous,
        absoluteChange,
        percentageChange
      };
    }
    default:
      throw new MetricmindError('UNKNOWN_RESULT_SHAPE', 'The query result shape is unsupported.');
  }
}

function number(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new MetricmindError('INVALID_NUMERIC_RESULT', `Invalid aggregate value: ${String(value)}`);
  }
  return parsed;
}
