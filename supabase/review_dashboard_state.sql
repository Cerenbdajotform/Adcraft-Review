create table if not exists public.review_dashboard_state (
  id text primary key,
  state jsonb not null default '{"version":1,"items":[]}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by text not null default '',
  source_file_name text not null default ''
);

insert into public.review_dashboard_state (
  id,
  state,
  updated_by,
  source_file_name
)
values (
  'primary',
  '{"version":1,"items":[]}'::jsonb,
  '',
  ''
)
on conflict (id) do nothing;
