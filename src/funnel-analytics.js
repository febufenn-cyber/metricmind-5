import { quoteIdentifier } from './config.js';
import { MetricmindError } from './errors.js';

export function compileFunnel(definition, period, workspace) {
  const steps = definition?.steps;
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 6) {
    throw new MetricmindError('INVALID_FUNNEL_STEPS', 'Funnels require between 2 and 6 ordered steps.');
  }
  const windowDays = Number(definition.conversionWindowDays ?? 7);
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90) {
    throw new MetricmindError('INVALID_FUNNEL_WINDOW', 'Funnel window must be 1 to 90 days.');
  }
  for (const step of steps) {
    if (!step?.eventName || String(step.eventName).length > 200) {
      throw new MetricmindError('INVALID_FUNNEL_STEP', 'Every funnel step requires an event name.');
    }
  }
  const table = `"${workspace.dataSource.schema}"."${workspace.dataSource.table}"`;
  const event = quoteIdentifier(workspace.dataSource.columns.eventName);
  const entity = quoteIdentifier(definition.entityColumn ?? workspace.dataSource.columns.userId);
  const occurred = quoteIdentifier(workspace.dataSource.columns.occurredAt);
  const bag = new Parameters();
  const start = bag.add(period.start.toISOString());
  const end = bag.add(period.end.toISOString());
  const window = bag.add(windowDays);
  const eventParams = steps.map((step) => bag.add(step.eventName));
  const selectors = steps.map((_, index) => {
    const nested = nestedExists(index, table, event, entity, occurred, eventParams, end, window);
    return `(SELECT COUNT(DISTINCT e1.${entity}) FROM ${table} e1 WHERE e1.${event} = ${eventParams[0]} AND e1.${occurred} >= ${start}::timestamptz AND e1.${occurred} < ${end}::timestamptz${nested}) AS step_${index + 1}`;
  });
  return {
    sql: `SELECT\n  ${selectors.join(',\n  ')}`,
    params: bag.values,
    expectedShape: 'advanced_funnel',
    allowedTables: [table]
  };
}

export function verifyFunnelResult(compiled, execution, definition) {
  if (!Array.isArray(execution?.rows) || execution.rows.length !== 1) {
    throw new MetricmindError('INVALID_FUNNEL_RESULT', 'Funnel query must return one row.');
  }
  const first = numeric(execution.rows[0].step_1);
  const steps = definition.steps.map((step, index) => {
    const users = numeric(execution.rows[0][`step_${index + 1}`]);
    return {
      id: step.id ?? `step_${index + 1}`,
      name: step.name ?? step.eventName,
      users,
      conversionFromFirst: first === 0 ? null : users / first,
      conversionFromPrevious: index === 0 ? 1 : numeric(execution.rows[0][`step_${index}`]) === 0 ? null : users / numeric(execution.rows[0][`step_${index}`])
    };
  });
  return { kind: 'funnel', windowDays: definition.conversionWindowDays ?? 7, steps };
}

function nestedExists(targetIndex, table, event, entity, occurred, eventParams, end, window) {
  if (targetIndex === 0) return '';
  let sql = '';
  let closings = '';
  for (let index = 1; index <= targetIndex; index += 1) {
    const current = `e${index + 1}`;
    const previous = `e${index}`;
    sql += ` AND EXISTS (SELECT 1 FROM ${table} ${current} WHERE ${current}.${entity} = ${previous}.${entity} AND ${current}.${event} = ${eventParams[index]} AND ${current}.${occurred} >= ${previous}.${occurred} AND ${current}.${occurred} < ${previous}.${occurred} + (${window} * INTERVAL '1 day') AND ${current}.${occurred} < ${end}::timestamptz`;
    closings += ')';
  }
  return sql + closings;
}

function numeric(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new MetricmindError('INVALID_FUNNEL_NUMBER', 'Funnel counts must be non-negative.');
  return number;
}
class Parameters { constructor(){this.values=[]} add(value){this.values.push(value);return `$${this.values.length}`} }
