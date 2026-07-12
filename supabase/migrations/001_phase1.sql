create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);

create table if not exists public.data_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  type text not null check (type = 'postgres'),
  encrypted_config text not null,
  allowed_schemas jsonb not null default '[]'::jsonb,
  allowed_tables jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'connected', 'error', 'revoked')),
  last_connected_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.schema_snapshots (
  id uuid primary key default gen_random_uuid(),
  data_source_id uuid not null references public.data_sources(id) on delete cascade,
  schema_hash text not null,
  schema_document jsonb not null,
  captured_at timestamptz not null default now()
);

create table if not exists public.metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric_key text not null,
  name text not null,
  description text not null,
  definition jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'verified', 'deprecated')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, metric_key)
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  question_text text not null,
  interpretation jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.query_runs (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  data_source_id uuid not null references public.data_sources(id),
  normalized_sql text not null,
  parameter_metadata jsonb not null default '[]'::jsonb,
  validation_status text not null,
  execution_status text not null,
  row_count integer,
  duration_ms integer,
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  query_run_id uuid references public.query_runs(id),
  headline text not null,
  narrative text not null,
  chart_spec jsonb,
  evidence jsonb not null,
  confidence text not null,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
alter table public.data_sources enable row level security;
alter table public.schema_snapshots enable row level security;
alter table public.metrics enable row level security;
alter table public.questions enable row level security;
alter table public.query_runs enable row level security;
alter table public.answers enable row level security;

-- Policies are intentionally not guessed here. Add them after the authenticated
-- membership model is defined; RLS enabled without policies is deny-by-default.
