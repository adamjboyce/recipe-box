-- Friend notes and photos wait for Adam's approval, like friend recipes.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Needs friend-recipes.sql to have been run first.

alter table public.notes add column if not exists status text not null default 'pending'
  check (status in ('pending','approved','rejected'));
update public.notes set status = 'approved' where status = 'pending';  -- everything posted so far stays up

-- Replace the old read/write policies on notes.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'notes' loop
    execute format('drop policy %I on public.notes', p.policyname);
  end loop;
end $$;
alter table public.notes enable row level security;

create policy "anyone can read approved notes" on public.notes
  for select to anon, authenticated using (status = 'approved');
create policy "anyone can post a note for review" on public.notes
  for insert to anon, authenticated with check (status = 'pending');

create or replace function public.rb_admin_notes(pass text) returns setof public.notes
language plpgsql security definer set search_path = public as $$
begin
  if not rb_is_admin(pass) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select * from notes where status = 'pending' order by created_at;
end $$;

create or replace function public.rb_admin_note(pass text, nid text, new_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not rb_is_admin(pass) then raise exception 'not allowed' using errcode = '42501'; end if;
  if new_status not in ('approved', 'rejected') then raise exception 'bad status'; end if;
  update notes set status = new_status where id::text = nid;
end $$;

grant execute on function public.rb_admin_notes(text) to anon, authenticated;
grant execute on function public.rb_admin_note(text, text, text) to anon, authenticated;
