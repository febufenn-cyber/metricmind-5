alter table public.investigations
  drop constraint if exists investigations_status_check;

alter table public.investigations
  add constraint investigations_status_check
  check (status in ('completed', 'limited', 'no_change'));

create table if not exists public.investigation_reviews (
  id text primary key,
  investigation_id text not null references public.investigations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  decision text not null check (decision in ('accepted', 'rejected', 'inconclusive')),
  note text,
  actor_id text not null,
  created_at timestamptz not null
);

create index if not exists investigation_reviews_investigation_idx
  on public.investigation_reviews (investigation_id, created_at asc);
create index if not exists investigation_reviews_org_created_idx
  on public.investigation_reviews (organization_id, created_at desc);

alter table public.investigation_reviews enable row level security;

-- Review decisions confirm usefulness or reject an investigation; they never
-- establish causality. Organization membership policies remain deployment-specific.
