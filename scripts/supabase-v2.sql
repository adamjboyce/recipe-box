-- Ark's Vibes & Vittles: recipes move into Supabase.
-- Run once in Supabase: SQL Editor > New query > paste the whole file > Run.
-- Safe to re-run. Needs friend-recipes.sql and note-moderation.sql to have run first (they have).
--
-- Model
--   recipes       one row per recipe, public fields plus a `private` jsonb (occasion, sources, flags...)
--   recipe_log    cook notes and change notes (change notes carry a snapshot of the recipe before the change)
--   rb_admins     Supabase Auth users who can edit (Adam)
--   rb_agent_tokens  revocable keys for Claude sessions; only the sha256 hash is stored
-- Public reads go through the recipes_public and recipe_aliases views (drafts and private fields never leave).
-- Every write goes through the rb_* functions, which accept either an admin login or an agent key.

-- ---------- who can edit ----------
create table if not exists public.rb_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.rb_admins enable row level security;

create table if not exists public.rb_agent_tokens (
  id bigint generated always as identity primary key,
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$'),
  label text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked boolean not null default false
);
alter table public.rb_agent_tokens enable row level security;

-- True for a signed-in admin. Granted to everyone so storage policies can call it.
create or replace function public.rb_am_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from rb_admins where user_id = auth.uid());
$$;

-- True for a signed-in admin or a valid agent key. Internal only.
create or replace function public.rb_can_edit(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare h text;
begin
  if rb_am_admin() then return true; end if;
  if p_token is null or length(p_token) < 32 then return false; end if;
  h := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  update rb_agent_tokens set last_used_at = now()
   where hash = h and not revoked and (expires_at is null or expires_at > now());
  return found;
end $$;

create or replace function public.rb_require(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not rb_can_edit(p_token) then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

-- ---------- recipes ----------
create table if not exists public.recipes (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 160),
  category text not null default 'Mains',
  cuisine text not null default '',
  yield text not null default '',
  tags text[] not null default '{}',
  traits text[] not null default '{}',
  diet text[] not null default '{}',
  groups jsonb not null default '[]',
  steps jsonb not null default '[]',
  notes text not null default '',
  nutrition jsonb,
  rating smallint not null default 0 check (rating between 0 and 5),
  photos jsonb not null default '[]',
  credit text,
  draft boolean not null default false,
  developed date,
  private jsonb not null default '{}',
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.recipes enable row level security;  -- no policies on purpose: reads via views, writes via functions

create table if not exists public.recipe_log (
  id uuid primary key default gen_random_uuid(),
  recipe_id text not null references public.recipes(id) on update cascade on delete cascade,
  kind text not null check (kind in ('cook', 'change')),
  date date not null default current_date,
  note text not null default '',
  rating smallint check (rating between 1 and 5),
  before jsonb,
  created_at timestamptz not null default now()
);
create index if not exists recipe_log_recipe_idx on public.recipe_log (recipe_id, date);
alter table public.recipe_log enable row level security;

revoke all on public.recipes, public.recipe_log, public.rb_admins, public.rb_agent_tokens from anon, authenticated;

-- ---------- public views ----------
create or replace view public.recipes_public as
  select r.id, r.title, r.category, r.cuisine, r.yield, r.tags, r.traits, r.diet, r.groups, r.steps, r.notes,
         r.nutrition, r.rating, r.photos, r.credit, r.developed, r.updated_at,
         coalesce((select jsonb_agg(jsonb_build_object('date', l.date, 'note', l.note) order by l.date, l.created_at)
                     from public.recipe_log l where l.recipe_id = r.id and l.kind = 'change'), '[]'::jsonb) as changes
    from public.recipes r
   where not r.draft;

create or replace view public.recipe_aliases as
  select a.alias, r.id from public.recipes r, unnest(r.aliases) as a(alias) where not r.draft;

grant select on public.recipes_public, public.recipe_aliases to anon, authenticated;

-- ---------- helpers ----------
create or replace function public.rb_txtarr(j jsonb) returns text[]
language sql immutable as $$
  select coalesce(array(select jsonb_array_elements_text(j)), '{}'::text[]);
$$;

create or replace function public.rb_snapshot(r public.recipes) returns jsonb
language sql immutable as $$
  select jsonb_build_object('title', r.title, 'yield', r.yield, 'groups', r.groups, 'steps', r.steps, 'notes', r.notes);
$$;

-- ---------- API ----------
-- Every recipe including drafts and private fields.
create or replace function public.rb_list(p_token text default null) returns setof public.recipes
language plpgsql security definer set search_path = public as $$
begin
  perform rb_require(p_token);
  return query select * from recipes order by title;
end $$;

-- One recipe with its full log.
create or replace function public.rb_get(p_id text, p_token text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r recipes; out jsonb;
begin
  perform rb_require(p_token);
  select * into r from recipes where id = p_id or p_id = any(aliases) limit 1;
  if not found then return null; end if;
  out := to_jsonb(r) || jsonb_build_object('log',
    coalesce((select jsonb_agg(to_jsonb(l) order by l.date, l.created_at) from recipe_log l where l.recipe_id = r.id), '[]'::jsonb));
  return out;
end $$;

-- Create or update. Only keys present in p_recipe change; `private` is merged (send a key as null to drop it).
-- A non-empty p_why logs a change note with a snapshot of the recipe as it was.
create or replace function public.rb_save(p_recipe jsonb, p_why text default null, p_token text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare p jsonb := p_recipe; rid text := p_recipe->>'id'; old recipes; r recipes;
begin
  perform rb_require(p_token);
  if rid is null then raise exception 'id is required'; end if;
  select * into old from recipes where id = rid for update;
  if not found then
    insert into recipes (id, title) values (rid, coalesce(p->>'title', rid)) returning * into old;
    old.title := null;  -- a brand new recipe never logs a "before"
  end if;
  update recipes set
    title     = case when p ? 'title'     then p->>'title'     else title end,
    category  = case when p ? 'category'  then p->>'category'  else category end,
    cuisine   = case when p ? 'cuisine'   then coalesce(p->>'cuisine', '') else cuisine end,
    yield     = case when p ? 'yield'     then coalesce(p->>'yield', '')   else yield end,
    tags      = case when p ? 'tags'      then rb_txtarr(p->'tags')        else tags end,
    traits    = case when p ? 'traits'    then rb_txtarr(p->'traits')      else traits end,
    diet      = case when p ? 'diet'      then rb_txtarr(p->'diet')        else diet end,
    groups    = case when p ? 'groups'    then p->'groups'                 else groups end,
    steps     = case when p ? 'steps'     then p->'steps'                  else steps end,
    notes     = case when p ? 'notes'     then coalesce(p->>'notes', '')   else notes end,
    nutrition = case when p ? 'nutrition' then p->'nutrition'              else nutrition end,
    rating    = case when p ? 'rating'    then coalesce((p->>'rating')::smallint, 0) else rating end,
    photos    = case when p ? 'photos'    then coalesce(p->'photos', '[]'::jsonb) else photos end,
    credit    = case when p ? 'credit'    then p->>'credit'                else credit end,
    draft     = case when p ? 'draft'     then coalesce((p->>'draft')::boolean, false) else draft end,
    developed = case when p ? 'developed' then (p->>'developed')::date     else developed end,
    private   = case when p ? 'private'   then jsonb_strip_nulls(private || coalesce(p->'private', '{}'::jsonb)) else private end,
    aliases   = case when p ? 'aliases'   then rb_txtarr(p->'aliases')     else aliases end,
    updated_at = now()
  where id = rid returning * into r;
  if old.title is not null and coalesce(btrim(p_why), '') <> '' and rb_snapshot(old) is distinct from rb_snapshot(r) then
    insert into recipe_log (recipe_id, kind, note, before) values (rid, 'change', btrim(p_why), rb_snapshot(old));
  end if;
  return to_jsonb(r);
end $$;

-- Add a cook note (or a manual change note). Rating, if given, also becomes the recipe's rating.
create or replace function public.rb_log(p_id text, p_note text, p_kind text default 'cook', p_date date default null,
                                         p_rating int default null, p_token text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l recipe_log;
begin
  perform rb_require(p_token);
  insert into recipe_log (recipe_id, kind, date, note, rating)
       values (p_id, p_kind, coalesce(p_date, current_date), coalesce(p_note, ''), p_rating) returning * into l;
  if p_rating is not null then update recipes set rating = p_rating, updated_at = now() where id = p_id; end if;
  return to_jsonb(l);
end $$;

create or replace function public.rb_log_delete(p_log_id uuid, p_token text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rb_require(p_token);
  delete from recipe_log where id = p_log_id;
end $$;

-- Bulk-load log entries as they are (used once, for the move out of the old box).
create or replace function public.rb_log_import(p_id text, p_entries jsonb, p_token text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform rb_require(p_token);
  insert into recipe_log (recipe_id, kind, date, note, rating, before)
  select p_id, coalesce(e->>'kind', 'cook'), coalesce((e->>'date')::date, current_date), coalesce(e->>'note', ''),
         nullif(e->>'rating', '')::smallint, e->'before'
    from jsonb_array_elements(p_entries) e;
  get diagnostics n = row_count;
  return n;
end $$;

-- Rename a recipe's id. The old id becomes an alias (old links keep working), logs follow,
-- friend notes follow and [label](old-id) links inside other recipes are rewritten.
create or replace function public.rb_rename(p_old text, p_new text, p_token text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rb_require(p_token);
  if p_new !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'bad id %', p_new; end if;
  update recipes set id = p_new,
         aliases = array_append(array_remove(aliases, p_new), p_old), updated_at = now()
   where id = p_old;
  if not found then raise exception 'no recipe %', p_old; end if;
  update notes set recipe_id = p_new where recipe_id = p_old;
  update recipes set
    groups = replace(groups::text, '](' || p_old || ')', '](' || p_new || ')')::jsonb,
    steps  = replace(steps::text,  '](' || p_old || ')', '](' || p_new || ')')::jsonb,
    notes  = replace(notes,        '](' || p_old || ')', '](' || p_new || ')')
   where groups::text like '%](' || p_old || ')%' or steps::text like '%](' || p_old || ')%'
      or notes like '%](' || p_old || ')%';
end $$;

create or replace function public.rb_delete(p_id text, p_token text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rb_require(p_token);
  delete from recipes where id = p_id;
end $$;

-- ---------- friend queues ----------
alter table public.recipe_submissions drop constraint if exists recipe_submissions_status_check;
alter table public.recipe_submissions add constraint recipe_submissions_status_check
  check (status in ('pending', 'approved', 'rejected', 'promoted'));

create or replace function public.rb_queue(p_token text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform rb_require(p_token);
  return jsonb_build_object(
    'submissions', coalesce((select jsonb_agg(to_jsonb(s) order by (s.status = 'pending') desc, s.created_at desc)
                               from recipe_submissions s where s.status in ('pending', 'approved')), '[]'::jsonb),
    'notes',       coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at)
                               from notes n where n.status = 'pending'), '[]'::jsonb));
end $$;

create or replace function public.rb_submission_save(p_sid uuid, p_fields jsonb, p_status text, p_token text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rb_require(p_token);
  if p_status not in ('pending', 'approved', 'rejected', 'promoted') then raise exception 'bad status'; end if;
  update recipe_submissions set
    title       = coalesce(p_fields->>'title', title),
    category    = coalesce(p_fields->>'category', category),
    yield       = coalesce(p_fields->>'yield', yield),
    ingredients = coalesce(p_fields->>'ingredients', ingredients),
    steps       = coalesce(p_fields->>'steps', steps),
    notes       = coalesce(p_fields->>'notes', notes),
    status = p_status, reviewed_at = now()
  where id = p_sid;
end $$;

create or replace function public.rb_note_set(p_nid text, p_status text, p_token text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rb_require(p_token);
  if p_status not in ('approved', 'rejected') then raise exception 'bad status'; end if;
  update notes set status = p_status where id::text = p_nid;
end $$;

-- ---------- agent keys (admin login only, never another key) ----------
create or replace function public.rb_token_add(p_hash text, p_label text, p_days int default 90) returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if not rb_am_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into rb_agent_tokens (hash, label, expires_at)
       values (lower(btrim(p_hash)), coalesce(p_label, ''), case when p_days is null then null else now() + make_interval(days => p_days) end)
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.rb_token_list() returns setof public.rb_agent_tokens
language plpgsql security definer set search_path = public as $$
begin
  if not rb_am_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select * from rb_agent_tokens order by created_at desc;
end $$;

create or replace function public.rb_token_revoke(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not rb_am_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update rb_agent_tokens set revoked = true where id = p_id;
end $$;

-- ---------- grants ----------
revoke execute on function public.rb_can_edit(text), public.rb_require(text) from public, anon, authenticated;
grant execute on function
  public.rb_am_admin(),
  public.rb_list(text), public.rb_get(text, text), public.rb_save(jsonb, text, text),
  public.rb_log(text, text, text, date, int, text), public.rb_log_delete(uuid, text), public.rb_log_import(text, jsonb, text),
  public.rb_rename(text, text, text), public.rb_delete(text, text),
  public.rb_queue(text), public.rb_submission_save(uuid, jsonb, text, text), public.rb_note_set(text, text, text),
  public.rb_token_add(text, text, int), public.rb_token_list(), public.rb_token_revoke(bigint)
to anon, authenticated;

-- ---------- photos: admins manage everything under recipes/ in the existing bucket ----------
drop policy if exists "admins manage recipe photos" on storage.objects;
create policy "admins manage recipe photos" on storage.objects
  for all to authenticated
  using (bucket_id = 'photos' and public.rb_am_admin())
  with check (bucket_id = 'photos' and public.rb_am_admin());

-- ---------- make Adam an admin ----------
-- 1. Supabase dashboard > Authentication > Users > Add user > Create new user:
--    your email and a password, with "Auto Confirm User" checked.
-- 2. Put that email below and run just this statement (or re-run the whole file):
insert into public.rb_admins (user_id)
  select id from auth.users where email = 'YOUR-EMAIL-HERE'
  on conflict do nothing;
