import { quoteIdentifier } from './config.js';
import { MetricmindError } from './errors.js';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateJoinPath(joinPath, workspace) {
  if (!joinPath?.id || joinPath.status !== 'verified') {
    throw new MetricmindError('UNVERIFIED_JOIN_PATH', 'A verified join path is required.');
  }
  if (!['one_to_one', 'many_to_one'].includes(joinPath.cardinality)) {
    throw new MetricmindError('UNSAFE_JOIN_CARDINALITY', 'Only one-to-one and many-to-one joins are supported.');
  }
  for (const value of [joinPath.left?.schema, joinPath.left?.table, joinPath.left?.column, joinPath.right?.schema, joinPath.right?.table, joinPath.right?.column]) {
    assertIdentifier(value, 'join identifier');
  }
  if (joinPath.left.schema !== workspace.dataSource.schema || joinPath.left.table !== workspace.dataSource.table) {
    throw new MetricmindError('JOIN_SOURCE_NOT_ALLOWLISTED', 'The join must begin from the configured analytics source.');
  }
  const configured = (workspace.dataSource.verifiedJoinPaths ?? []).find((item) => item.id === joinPath.id);
  if (!configured || JSON.stringify(configured) !== JSON.stringify(joinPath)) {
    throw new MetricmindError('JOIN_PATH_NOT_CONFIGURED', 'The join path is not present in organization configuration.');
  }
  return joinPath;
}

export function compileMeasure(definition, period, workspace) {
  const aggregation = definition?.aggregation;
  if (!['sum', 'average'].includes(aggregation)) {
    throw new MetricmindError('INVALID_MEASURE_AGGREGATION', 'Measure aggregation must be sum or average.');
  }
  assertIdentifier(definition.column, 'measure column');
  const bag = new Parameters();
  const occurred = quoteIdentifier(workspace.dataSource.columns.occurredAt);
  const conditions = periodConditions(occurred, period, bag);
  const table = qualified(workspace.dataSource.schema, workspace.dataSource.table);
  if (definition.currency) {
    if (definition.currency.normalized !== true) {
      throw new MetricmindError('UNNORMALIZED_CURRENCY', 'Currency measures require a normalized single-currency source.');
    }
    assertIdentifier(definition.currency.column, 'currency column');
    conditions.push(`${quoteIdentifier(definition.currency.column)} = ${bag.add(definition.currency.code)}`);
  }
  const column = quoteIdentifier(definition.column);
  const expression = aggregation === 'sum' ? `COALESCE(SUM(${column}), 0)` : `COALESCE(AVG(${column}), 0)`;
  return compiled(`SELECT ${expression} AS value\nFROM ${table}\nWHERE ${conditions.join(' AND ')}`, bag, [table]);
}

export function compileJoinedMeasure(definition, period, workspace) {
  const joinPath = validateJoinPath(definition?.joinPath, workspace);
  if (!['sum', 'average'].includes(definition.aggregation)) {
    throw new MetricmindError('INVALID_MEASURE_AGGREGATION', 'Joined measure aggregation must be sum or average.');
  }
  if (!['left', 'right'].includes(definition.valueSide)) {
    throw new MetricmindError('INVALID_MEASURE_SIDE', 'valueSide must be left or right.');
  }
  assertIdentifier(definition.column, 'measure column');
  const leftTable = qualified(joinPath.left.schema, joinPath.left.table);
  const rightTable = qualified(joinPath.right.schema, joinPath.right.table);
  const bag = new Parameters();
  const conditions = periodConditions(`l.${quoteIdentifier(workspace.dataSource.columns.occurredAt)}`, period, bag);
  const value = `${definition.valueSide === 'left' ? 'l' : 'r'}.${quoteIdentifier(definition.column)}`;
  const expression = definition.aggregation === 'sum' ? `COALESCE(SUM(${value}), 0)` : `COALESCE(AVG(${value}), 0)`;
  const sql = `SELECT ${expression} AS value\nFROM ${leftTable} l\nJOIN ${rightTable} r ON l.${quoteIdentifier(joinPath.left.column)} = r.${quoteIdentifier(joinPath.right.column)}\nWHERE ${conditions.join(' AND ')}`;
  return compiled(sql, bag, [leftTable, rightTable]);
}

export function verifyMeasureResult(execution) {
  if (!Array.isArray(execution?.rows) || execution.rows.length !== 1) {
    throw new MetricmindError('INVALID_MEASURE_RESULT', 'Measure query must return one row.');
  }
  const value = Number(execution.rows[0].value);
  if (!Number.isFinite(value)) throw new MetricmindError('INVALID_MEASURE_RESULT', 'Measure result must be numeric.');
  return { kind: 'measure', value };
}

function compiled(sql, bag, allowedTables) {
  return { sql, params: bag.values, expectedShape: 'advanced_measure', allowedTables };
}
function periodConditions(column, period, bag) {
  if (!period?.start || !period?.end) throw new MetricmindError('ADVANCED_PERIOD_REQUIRED', 'A complete period is required.');
  return [`${column} >= ${bag.add(period.start.toISOString())}::timestamptz`, `${column} < ${bag.add(period.end.toISOString())}::timestamptz`];
}
function qualified(schema, table) {
  assertIdentifier(schema, 'schema'); assertIdentifier(table, 'table');
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}
function assertIdentifier(value, label) {
  if (!IDENTIFIER.test(String(value ?? ''))) throw new MetricmindError('INVALID_ADVANCED_IDENTIFIER', `Invalid ${label}.`);
}
class Parameters { constructor(){this.values=[]} add(value){this.values.push(value);return `$${this.values.length}`} }
