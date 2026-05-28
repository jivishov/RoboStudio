-- Supabase table for Robotic Component Builder saved part-library items.
-- Run in the Supabase SQL editor, then add Google as an Auth provider and
-- allow the deployed callback URL, for example:
-- https://<account>.github.io/RoboStudio/auth-callback.html

create table if not exists public.part_library_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  name text not null,
  item jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.part_library_items enable row level security;

create policy "Users can read their own part library items"
  on public.part_library_items
  for select
  using (auth.uid() = user_id);

create policy "Users can insert their own part library items"
  on public.part_library_items
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own part library items"
  on public.part_library_items
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own part library items"
  on public.part_library_items
  for delete
  using (auth.uid() = user_id);
