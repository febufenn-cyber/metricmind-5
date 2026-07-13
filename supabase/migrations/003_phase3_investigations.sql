create table if not exists public.investigations (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  question text not null,
  status text not null check (status in ('completed', 'limited')),
  metric_id text not null,
  metric_version_id text not null,
  definition_hash text not null,
  semantic_revision bigint,
  headline text not null,
  baseline jsonb not null,
  periods jsonb not null,
  data_quality jsonb not null,
  observations jsonb not null default '[]'::jsonb,
  hypotheses jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  confidence jsonb not null,
  causal_status text not null check (causal_status = 'not_established'),
  next_checks jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  requested_by text,
  created_at timestamptz not null
);

create index if not exists investigations_org_created_idx
  on public.investigations (organization_id, created_at desc);
create index if not exists investigations_org_metric_idx
  on public.investigations (organization_id, metric_id, created_at desc);

alter table public.investigations enable row level security;

-- Organization membership policies remain deployment-specific. RLS is enabled
-- without policies so direct access is deny-by-default until the auth model is wired.
