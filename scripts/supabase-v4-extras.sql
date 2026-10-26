-- A general-purpose public `extras` field on recipes, first used for the spicy toggle.
-- Future card features can live in extras without another schema change.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run. Needs v2 and v3 first.
--
--   extras.spicy = {"swaps": [{"from": "<exact ingredient line>", "to": "<spicy line>"}],
--                   "add":   [{"group": "<group name or empty>", "line": "<extra ingredient line>"}],
--                   "steps": [{"from": "<exact step>", "to": "<spicy step>"}]}

alter table public.recipes add column if not exists extras jsonb not null default '{}';

create or replace view public.recipes_public as
  select r.id, r.title, r.category, r.cuisine, r.yield, r.tags, r.traits, r.diet, r.groups, r.steps, r.notes,
         r.nutrition, r.rating, r.photos, r.credit, r.developed, r.updated_at,
         coalesce((select jsonb_agg(jsonb_build_object('date', l.date, 'note', l.note) order by l.date, l.created_at)
                     from public.recipe_log l where l.recipe_id = r.id and l.kind = 'change'), '[]'::jsonb) as changes,
         r.method, r.alt_methods, r.extras
    from public.recipes r
   where not r.draft;
grant select on public.recipes_public to anon, authenticated;

create or replace function public.rb_snapshot(r public.recipes) returns jsonb
language sql immutable as $$
  select jsonb_build_object('title', r.title, 'yield', r.yield, 'groups', r.groups, 'steps', r.steps, 'notes', r.notes,
                            'method', r.method, 'alt_methods', r.alt_methods, 'extras', r.extras);
$$;

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
    title       = case when p ? 'title'       then p->>'title'       else title end,
    category    = case when p ? 'category'    then p->>'category'    else category end,
    cuisine     = case when p ? 'cuisine'     then coalesce(p->>'cuisine', '') else cuisine end,
    yield       = case when p ? 'yield'       then coalesce(p->>'yield', '')   else yield end,
    tags        = case when p ? 'tags'        then rb_txtarr(p->'tags')        else tags end,
    traits      = case when p ? 'traits'      then rb_txtarr(p->'traits')      else traits end,
    diet        = case when p ? 'diet'        then rb_txtarr(p->'diet')        else diet end,
    groups      = case when p ? 'groups'      then p->'groups'                 else groups end,
    steps       = case when p ? 'steps'       then p->'steps'                  else steps end,
    notes       = case when p ? 'notes'       then coalesce(p->>'notes', '')   else notes end,
    nutrition   = case when p ? 'nutrition'   then p->'nutrition'              else nutrition end,
    method      = case when p ? 'method'      then coalesce(p->>'method', '')  else method end,
    alt_methods = case when p ? 'alt_methods' then coalesce(p->'alt_methods', '[]'::jsonb) else alt_methods end,
    extras      = case when p ? 'extras'      then jsonb_strip_nulls(extras || coalesce(p->'extras', '{}'::jsonb)) else extras end,
    rating      = case when p ? 'rating'      then coalesce((p->>'rating')::smallint, 0) else rating end,
    photos      = case when p ? 'photos'      then coalesce(p->'photos', '[]'::jsonb) else photos end,
    credit      = case when p ? 'credit'      then p->>'credit'                else credit end,
    draft       = case when p ? 'draft'       then coalesce((p->>'draft')::boolean, false) else draft end,
    developed   = case when p ? 'developed'   then (p->>'developed')::date     else developed end,
    private     = case when p ? 'private'     then jsonb_strip_nulls(private || coalesce(p->'private', '{}'::jsonb)) else private end,
    aliases     = case when p ? 'aliases'     then rb_txtarr(p->'aliases')     else aliases end,
    updated_at  = now()
  where id = rid returning * into r;
  if old.title is not null and coalesce(btrim(p_why), '') <> '' and rb_snapshot(old) is distinct from rb_snapshot(r) then
    insert into recipe_log (recipe_id, kind, note, before) values (rid, 'change', btrim(p_why), rb_snapshot(old));
  end if;
  return to_jsonb(r);
end $$;

grant execute on function public.rb_save(jsonb, text, text) to anon, authenticated;
