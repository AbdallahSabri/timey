-- Demo table backing the /todos CRUD flow. See README "Strip the demo CRUD"
-- to remove this once you no longer need the example.
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) > 0),
  is_complete boolean not null default false,
  inserted_at timestamptz not null default now()
);

alter table public.todos enable row level security;

-- Permissive demo policies so the anon key can exercise full CRUD without
-- auth wired up yet. Tighten (e.g. scope to auth.uid()) before shipping
-- anything beyond this template's demo flow.
create policy "Public todos are viewable by everyone"
  on public.todos for select
  using (true);

create policy "Anyone can insert todos"
  on public.todos for insert
  with check (true);

create policy "Anyone can update todos"
  on public.todos for update
  using (true);

create policy "Anyone can delete todos"
  on public.todos for delete
  using (true);
