-- Friends' recipes: submissions, an approval queue and a passcode for Adam.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- BEFORE RUNNING: replace PICK-A-PASSCODE (near the bottom) with your own passcode.

create table if not exists public.recipe_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 60),
  title text not null check (char_length(title) between 1 and 120),
  category text check (char_length(category) <= 40),
  yield text check (char_length(yield) <= 120),
  ingredients text not null check (char_length(ingredients) between 1 and 8000),
  steps text not null check (char_length(steps) between 1 and 12000),
  notes text check (char_length(notes) <= 4000),
  photo_path text check (char_length(photo_path) <= 200),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_at timestamptz
);
alter table public.recipe_submissions enable row level security;

-- Anyone can send one in, but it always starts as pending.
create policy "anyone can submit" on public.recipe_submissions
  for insert to anon, authenticated
  with check (status = 'pending' and reviewed_at is null);

-- Only approved recipes are readable from the site.
create policy "anyone can read approved" on public.recipe_submissions
  for select to anon, authenticated
  using (status = 'approved');

-- Friends can attach a photo (stored under photos/submissions/).
create policy "submission photos upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = 'submissions');

-- Adam's passcode, stored only as a hash. No policies, so nothing outside
-- these functions can read it.
create table if not exists public.rb_admin (hash text not null);
alter table public.rb_admin enable row level security;
delete from public.rb_admin;
insert into public.rb_admin (hash)
  values (encode(sha256(convert_to('PICK-A-PASSCODE', 'UTF8')), 'hex'));

create or replace function public.rb_is_admin(pass text) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from rb_admin
    where hash = encode(sha256(convert_to(coalesce(pass, ''), 'UTF8')), 'hex'));
$$;
revoke execute on function public.rb_is_admin(text) from public, anon, authenticated;

create or replace function public.rb_admin_list(pass text)
returns setof public.recipe_submissions
language plpgsql security definer set search_path = public as $$
begin
  if not rb_is_admin(pass) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select * from recipe_submissions
    order by (status = 'pending') desc, created_at desc;
end $$;

create or replace function public.rb_admin_save(pass text, sid uuid, fields jsonb, new_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not rb_is_admin(pass) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if new_status not in ('pending', 'approved', 'rejected') then
    raise exception 'bad status';
  end if;
  update recipe_submissions set
    title       = coalesce(fields->>'title', title),
    category    = coalesce(fields->>'category', category),
    yield       = coalesce(fields->>'yield', yield),
    ingredients = coalesce(fields->>'ingredients', ingredients),
    steps       = coalesce(fields->>'steps', steps),
    notes       = coalesce(fields->>'notes', notes),
    status      = new_status,
    reviewed_at = now()
  where id = sid;
end $$;

grant execute on function public.rb_admin_list(text) to anon, authenticated;
grant execute on function public.rb_admin_save(text, uuid, jsonb, text) to anon, authenticated;
