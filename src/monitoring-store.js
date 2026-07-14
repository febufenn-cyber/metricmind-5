import { MetricmindError } from './errors.js';
import { validateMonitoringRule } from './monitoring.js';

const processState = { rules: new Map(), runs: new Map(), deliveries: [] };

export function createMonitoringStore(env = {}) {
  if (env.MONITORING_STORE) return new BindingMonitoringStore(env.MONITORING_STORE);
  if (env.METADATA_DB) return new PostgresMonitoringStore(env.METADATA_DB);
  return new MemoryMonitoringStore(processState, 'ephemeral');
}

export class MemoryMonitoringStore {
  constructor(state = { rules: new Map(), runs: new Map(), deliveries: [] }, mode = 'memory') {
    this.state = state;
    this.mode = mode;
  }
  async saveRule(organizationId, rule) {
    const record = validateMonitoringRule({ ...structuredClone(rule), organizationId });
    this.state.rules.set(key(organizationId, record.id), record);
    return structuredClone(record);
  }
  async listRules(organizationId) {
    return [...this.state.rules.values()].filter((rule) => rule.organizationId === organizationId).map(structuredClone);
  }
  async listDue(now = new Date()) {
    return [...this.state.rules.values()].filter((rule) => rule.enabled && isDue(rule, now)).map(structuredClone);
  }
  async claim(ruleId, idempotencyKey) {
    const claimKey = `${ruleId}:${idempotencyKey}`;
    if (this.state.runs.has(claimKey)) return false;
    this.state.runs.set(claimKey, { status: 'running', createdAt: new Date().toISOString() });
    return true;
  }
  async complete(ruleId, idempotencyKey, run) {
    this.state.runs.set(`${ruleId}:${idempotencyKey}`, structuredClone(run));
    return structuredClone(run);
  }
  async latestTriggered(ruleId) {
    return [...this.state.runs.values()].filter((run) => run.ruleId === ruleId && run.evaluation?.triggered).sort((a,b)=>String(b.completedAt).localeCompare(String(a.completedAt)))[0] ?? null;
  }
  async recordDelivery(delivery) {
    this.state.deliveries.push(structuredClone(delivery));
    return structuredClone(delivery);
  }
  async listDeliveries(organizationId, limit = 50) {
    return this.state.deliveries.filter((item) => item.organizationId === organizationId).slice(-bounded(limit)).reverse().map(structuredClone);
  }
}

class BindingMonitoringStore {
  constructor(binding) {
    for (const method of ['saveRule','listRules','listDue','claim','complete','latestTriggered','recordDelivery','listDeliveries']) {
      if (typeof binding?.[method] !== 'function') throw new MetricmindError('INVALID_MONITORING_STORE', `MONITORING_STORE must implement ${method}().`, undefined, 500);
    }
    this.binding = binding; this.mode = 'persistent';
  }
  async saveRule(org, rule){return validateMonitoringRule(await this.binding.saveRule(org, validateMonitoringRule({...rule,organizationId:org})))}
  async listRules(org){return (await this.binding.listRules(org)).map(validateMonitoringRule)}
  async listDue(now){return (await this.binding.listDue(now)).map(validateMonitoringRule)}
  async claim(...args){return Boolean(await this.binding.claim(...args))}
  async complete(...args){return this.binding.complete(...args)}
  async latestTriggered(...args){return this.binding.latestTriggered(...args)}
  async recordDelivery(...args){return this.binding.recordDelivery(...args)}
  async listDeliveries(...args){return this.binding.listDeliveries(...args)}
}

class PostgresMonitoringStore {
  constructor(binding) { if (typeof binding?.query !== 'function') throw new MetricmindError('METADATA_STORE_NOT_CONFIGURED','METADATA_DB query binding is required.',undefined,503); this.binding=binding; this.mode='persistent'; }
  async saveRule(org, rule) {
    const record=validateMonitoringRule({...rule,organizationId:org});
    const rows=await query(this.binding,`INSERT INTO public.monitoring_rules (id, organization_id, rule, enabled, next_run_at) VALUES ($1,$2::uuid,$3::jsonb,$4,$5::timestamptz) ON CONFLICT (organization_id,id) DO UPDATE SET rule=$3::jsonb, enabled=$4, next_run_at=$5::timestamptz, updated_at=now() RETURNING rule`,[record.id,org,JSON.stringify(record),record.enabled,record.nextRunAt??new Date().toISOString()],false);
    return validateMonitoringRule(parse(rows[0].rule));
  }
  async listRules(org){const rows=await query(this.binding,'SELECT rule FROM public.monitoring_rules WHERE organization_id=$1::uuid ORDER BY created_at DESC',[org],true,100);return rows.map((row)=>validateMonitoringRule(parse(row.rule)))}
  async listDue(now){const rows=await query(this.binding,'SELECT rule FROM public.monitoring_rules WHERE enabled=true AND next_run_at <= $1::timestamptz ORDER BY next_run_at LIMIT 100',[now.toISOString()],true,100);return rows.map((row)=>validateMonitoringRule(parse(row.rule)))}
  async claim(ruleId,idempotencyKey){try{await query(this.binding,'INSERT INTO public.monitoring_runs (rule_id,idempotency_key,status) VALUES ($1,$2,\'running\')',[ruleId,idempotencyKey],false);return true}catch(error){if(String(error?.code)==='23505')return false;throw error}}
  async complete(ruleId,idempotencyKey,run){const rows=await query(this.binding,'UPDATE public.monitoring_runs SET status=$3, run=$4::jsonb, completed_at=now() WHERE rule_id=$1 AND idempotency_key=$2 RETURNING run',[ruleId,idempotencyKey,run.status,JSON.stringify(run)],false);return parse(rows[0]?.run??run)}
  async latestTriggered(ruleId){const rows=await query(this.binding,"SELECT run FROM public.monitoring_runs WHERE rule_id=$1 AND run->'evaluation'->>'triggered'='true' ORDER BY completed_at DESC LIMIT 1",[ruleId],true,1);return rows[0]?parse(rows[0].run):null}
  async recordDelivery(delivery){const rows=await query(this.binding,'INSERT INTO public.notification_deliveries (organization_id,rule_id,destination_id,status,delivery) VALUES ($1::uuid,$2,$3,$4,$5::jsonb) RETURNING delivery',[delivery.organizationId,delivery.ruleId,delivery.destinationId,delivery.status,JSON.stringify(delivery)],false);return parse(rows[0].delivery)}
  async listDeliveries(org,limit=50){const rows=await query(this.binding,'SELECT delivery FROM public.notification_deliveries WHERE organization_id=$1::uuid ORDER BY created_at DESC LIMIT $2',[org,bounded(limit)],true,bounded(limit));return rows.map((row)=>parse(row.delivery))}
}

function isDue(rule, now){return !rule.nextRunAt || new Date(rule.nextRunAt).getTime()<=now.getTime()}
async function query(binding,sql,params,readOnly,maximumRows=10){const result=await binding.query(sql,params,{readOnly,statementTimeoutMs:5000,maximumRows});const rows=Array.isArray(result)?result:result?.rows;if(!Array.isArray(rows))throw new MetricmindError('INVALID_MONITORING_STORE_RESPONSE','Monitoring store did not return rows.',undefined,502);return rows}
function parse(value){return typeof value==='string'?JSON.parse(value):structuredClone(value)}
function key(org,id){return `${org}:${id}`}
function bounded(value){const parsed=Number(value);if(!Number.isInteger(parsed)||parsed<1||parsed>100)throw new MetricmindError('INVALID_MONITORING_LIMIT','limit must be 1 to 100.');return parsed}
