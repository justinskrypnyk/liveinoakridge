-- Splits profiles.full_name into first_name/last_name (to match GHL's
-- firstName/lastName fields and the pattern already used by
-- home_watch_subscriptions/saved_listings/saved_searches). Run this once in
-- the Supabase SQL Editor if your profiles table was created before this
-- migration -- schema.sql itself already reflects the split for anyone
-- setting the tables up fresh.
alter table profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

update profiles
set
  first_name = coalesce(first_name, split_part(full_name, ' ', 1)),
  last_name = coalesce(last_name, nullif(trim(substring(full_name from length(split_part(full_name, ' ', 1)) + 1)), ''))
where full_name is not null and first_name is null;

alter table profiles drop column if exists full_name;
