-- Phase 7: scheduled analyses, alert runs, and notification delivery history.

create table if not exists public.monitoring_rules (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule jsonb not null,
  enabled boolean not null default true,
  next_run_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists monitoring_rules_due_idx on public.monitoring_rules (enabled, next_run_at);
create index if not exists monitoring_rules_org_idx on public.monitoring_rules (organization_id, created_at desc);

create table if not exists public.monitoring_runs (
  id bigint generated always as identity primary key,
  rule_id text not null references public.monitoring_rules(id) on delete cascade,
  idempotency_key text not null,
  status text not null check (status in ('running','completed','failed')),
  run jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (rule_id, idempotency_key)
);

create table if not exists public.notification_deliveries (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id text not null references public.monitoring_rules(id) on delete cascade,
  destination_id text not null,
  status text not null check (status in ('delivered','dead_letter')),
  delivery jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists notification_deliveries_org_idx on public.notification_deliveries (organization_id, created_at desc);

alter table public.monitoring_rules enable row level security;
alter table public.monitoring_runs enable row level security;
alter table public.notification_deliveries enable row level security;

drop policy if exists monitoring_members_read on public.monitoring_rules;
create policy monitoring_members_read on public.monitoring_rules for select to authenticated
using (public.metricmind_has_role(organization_id, array['viewer','analyst','metric_editor','metric_approver','organization_admin']::public.organization_role[]));

drop policy if exists monitoring_admin_write on public.monitoring_rules;
create policy monitoring_admin_write on public.monitoring_rules for all to authenticated
using (public.metricmind_has_role(organization_id, array['organization_admin']::public.organization_role[]))
with check (public.metricmind_has_role(organization_id, array['organization_admin']::public.organization_role[]));

drop policy if exists monitoring_runs_members_read on public.monitoring_runs;
create policy monitoring_runs_members_read on public.monitoring_runs for select to authenticated
using (exists (select 1 from public.monitoring_rules r where r.id=rule_id and public.metricmind_has_role(r.organization_id, array['viewer','analyst','metric_editor','metric_approver','organization_admin']::public.organization_role[])));

drop policy if exists deliveries_members_read on public.notification_deliveries;
create policy deliveries_members_read on public.notification_deliveries for select to authenticated
using (public.metricmind_has_role(organization_id, array['viewer','analyst','metric_editor','metric_approver','organization_admin']::public.organization_role[]));

-- Runs and deliveries are written by the trusted scheduled Worker/service role.
