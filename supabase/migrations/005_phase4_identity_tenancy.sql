-- Phase 4: authenticated tenancy and durable application stores.

do $$ begin
  create type public.organization_role as enum (
    'viewer', 'analyst', 'metric_editor', 'metric_approver', 'organization_admin'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'viewer',
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.semantic_catalog_snapshots (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  catalog jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investigation_records (
  id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric_id text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  record jsonb not null,
  primary key (organization_id, id)
);

create index if not exists investigation_records_org_metric_created_idx
  on public.investigation_records (organization_id, metric_id, created_at desc);

create table if not exists public.warehouse_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  hyperdrive_binding_name text not null,
  warehouse_type text not null default 'postgres' check (warehouse_type = 'postgres'),
  schema_name text not null,
  table_name text not null,
  column_mapping jsonb not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.application_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  object_type text not null,
  object_id text,
  correlation_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_org_created_idx
  on public.application_audit_log (organization_id, created_at desc);

alter table public.organization_memberships enable row level security;
alter table public.semantic_catalog_snapshots enable row level security;
alter table public.investigation_records enable row level security;
alter table public.warehouse_mappings enable row level security;
alter table public.application_audit_log enable row level security;

create or replace function public.metricmind_has_role(target_organization uuid, allowed_roles public.organization_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = target_organization
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(allowed_roles)
  );
$$;

revoke all on function public.metricmind_has_role(uuid, public.organization_role[]) from public;
grant execute on function public.metricmind_has_role(uuid, public.organization_role[]) to authenticated;

drop policy if exists memberships_select_self_or_admin on public.organization_memberships;
create policy memberships_select_self_or_admin on public.organization_memberships
for select to authenticated
using (user_id = auth.uid() or public.metricmind_has_role(organization_id, array['organization_admin']::public.organization_role[]));

drop policy if exists memberships_admin_write on public.organization_memberships;
create policy memberships_admin_write on public.organization_memberships
for all to authenticated
using (public.metricmind_has_role(organization_id, array['organization_admin']::public.organization_role[]))
with check (public.metricmind_has_role(organization_id, array['organization_admin']::public.organization_role[]));

drop policy if exists semantic_members_read on public.semantic_catalog_snapshots;
create policy semantic_members_read on public.semantic_catalog_snapshots
for select to authenticated
using (public.metricmind_has_role(organization_id, array['viewer','analyst','metric_editor','metric_approver','organization_admin']::public.organization_role[]));

drop policy if exists semantic_editors_write on public.semantic_catalog_snapshots;
create policy semantic_editors_write on public.semantic_catalog_snapshots
for all to authenticated
using (public.metricmind_has_role(organization_id, array['metric_editor','metric_approver','organization_admin']::public.organization_role[]))
with check (public.metricmind_has_role(organization_id, array['metric_editor','metric_approver','organization_admin']::public.organization_role[]));

drop policy if exists investigations_members_read on public.investigation_records;
create policy investigations_members_read on public.investigation_records
for select to authenticated
using (public.metricmind_has_role(organization_id, array['viewer','analyst','metric_editor','metric_approver','organization_admin']::public.organization_role[]));

drop policy if exists investigations_analysts_write on public.investigation_records;
create policy investigations_analysts_write on public.investigation_records
for all to authenticated
using (public.metricmind_has_role(organization_id, array['analyst','metric_editor','metric_approver','organization_admin']::public.organization_role[]))
with check (public.metricmind_has_role(organization_id, array['analyst','metric_editor','metric_approver','organization_admin']::public.organization_role[]));

drop policy if exists mappings_members_read on public.warehouse_mappings;
create policy mappings_members_read on public.warehouse_mappings
for select to authenticated
using (public.metricmind_has_role(organization_id, array['viewer','analyst','metric_editor','metric_approver','organization_admin']::public.organization_role[]));

drop policy if exists mappings_admin_write on public.warehouse_mappings;
create policy mappings_admin_write on public.warehouse_mappings
for all to authenticated
using (public.metricmind_has_role(organization_id, array['organization_admin']::public.organization_role[]))
with check (public.metricmind_has_role(organization_id, array['organization_admin']::public.organization_role[]));

drop policy if exists audit_members_read on public.application_audit_log;
create policy audit_members_read on public.application_audit_log
for select to authenticated
using (public.metricmind_has_role(organization_id, array['metric_approver','organization_admin']::public.organization_role[]));

-- Audit inserts are expected through the trusted backend/service role. No direct
-- authenticated insert policy is intentionally created.
