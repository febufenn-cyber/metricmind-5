create table if not exists public.semantic_entities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_key text not null,
  name text not null,
  source_definition jsonb not null,
  identity_note text,
  status text not null default 'draft' check (status in ('draft', 'verified', 'deprecated')),
  created_at timestamptz not null default now(),
  unique (organization_id, entity_key)
);

create table if not exists public.semantic_dimensions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dimension_key text not null,
  name text not null,
  source_definition jsonb not null,
  aliases jsonb not null default '[]'::jsonb,
  privacy_classification text not null check (privacy_classification in ('safe_dimension', 'identifier', 'personal', 'sensitive', 'restricted', 'unknown')),
  null_policy text not null default 'group_as_unknown' check (null_policy in ('group_as_unknown', 'exclude', 'invalid')),
  maximum_cardinality integer not null default 100 check (maximum_cardinality between 1 and 10000),
  status text not null default 'draft' check (status in ('draft', 'verified', 'deprecated')),
  created_at timestamptz not null default now(),
  unique (organization_id, dimension_key)
);

create table if not exists public.semantic_exclusion_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  exclusion_key text not null,
  name text not null,
  description text,
  rules jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'verified', 'deprecated')),
  created_at timestamptz not null default now(),
  unique (organization_id, exclusion_key)
);

create table if not exists public.semantic_metric_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric_key text not null,
  name text not null,
  description text not null,
  owner_user_id uuid,
  category text,
  created_at timestamptz not null default now(),
  unique (organization_id, metric_key)
);

create table if not exists public.semantic_metric_aliases (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null references public.semantic_metric_definitions(id) on delete cascade,
  normalized_alias text not null,
  display_alias text not null,
  created_at timestamptz not null default now(),
  unique (metric_id, normalized_alias)
);

create table if not exists public.semantic_metric_versions (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null references public.semantic_metric_definitions(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'verified', 'active', 'superseded', 'deprecated')),
  definition jsonb not null,
  definition_hash text not null,
  history_policy text not null default 'restated' check (history_policy in ('restated', 'effective_dated')),
  effective_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  verified_by uuid,
  verified_at timestamptz,
  activated_at timestamptz,
  unique (metric_id, version_number),
  unique (metric_id, definition_hash)
);

create unique index if not exists semantic_one_active_version_per_metric
  on public.semantic_metric_versions(metric_id)
  where status = 'active';

create table if not exists public.semantic_metric_dependencies (
  metric_version_id uuid not null references public.semantic_metric_versions(id) on delete cascade,
  depends_on_metric_id uuid not null references public.semantic_metric_definitions(id),
  dependency_role text not null check (dependency_role in ('numerator', 'denominator', 'component', 'exclusion')),
  primary key (metric_version_id, depends_on_metric_id, dependency_role)
);

create table if not exists public.semantic_validation_runs (
  id uuid primary key default gen_random_uuid(),
  metric_version_id uuid not null references public.semantic_metric_versions(id) on delete cascade,
  status text not null check (status in ('pending', 'passed', 'warning', 'failed')),
  checks jsonb not null default '[]'::jsonb,
  preview_results jsonb,
  query_duration_ms integer,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.semantic_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid,
  action text not null,
  object_type text not null,
  object_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.prevent_semantic_version_rewrite()
returns trigger
language plpgsql
as $$
begin
  if old.version_number <> new.version_number or old.metric_id <> new.metric_id then
    raise exception 'semantic metric version identity is immutable';
  end if;
  if old.status in ('verified', 'active', 'superseded', 'deprecated')
     and (old.definition <> new.definition or old.definition_hash <> new.definition_hash or old.history_policy <> new.history_policy) then
    raise exception 'verified semantic metric definitions are immutable';
  end if;
  return new;
end;
$$;

create trigger semantic_metric_versions_immutable
before update on public.semantic_metric_versions
for each row execute function public.prevent_semantic_version_rewrite();

alter table public.semantic_entities enable row level security;
alter table public.semantic_dimensions enable row level security;
alter table public.semantic_exclusion_sets enable row level security;
alter table public.semantic_metric_definitions enable row level security;
alter table public.semantic_metric_aliases enable row level security;
alter table public.semantic_metric_versions enable row level security;
alter table public.semantic_metric_dependencies enable row level security;
alter table public.semantic_validation_runs enable row level security;
alter table public.semantic_audit_events enable row level security;

-- Phase 2 keeps RLS deny-by-default until organization membership policies are
-- introduced. Service-side semantic writes must not bypass organization scope.
