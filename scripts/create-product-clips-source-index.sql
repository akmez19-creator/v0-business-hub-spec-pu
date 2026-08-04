-- Clip dedupe (feature 9): stop the same source clip being saved twice.
--
-- The API already checks for an existing row before inserting, but that
-- "select then insert" has a race: two clips saved in the same moment both
-- see nothing and both insert. This index makes the database the arbiter.
--
-- NOT YET APPLIED: the Supabase MCP was unavailable when this was written, so
-- run this manually (Supabase SQL editor) to finish the feature. Everything
-- works without it; only the concurrent-save race remains open until it runs.
--
-- The API handles the resulting 23505 unique violation by returning the row
-- that won the race, so applying this cannot break a save.

-- Partial, so uploaded clips (which have no source id) are unaffected and can
-- still be added freely - only clips traced back to a search result dedupe.
create unique index if not exists product_clips_source_id_key
  on public.product_clips (source_id)
  where source_id is not null;

-- Supports the batch "which of these results are already saved" lookup that
-- badges search results, which queries by url for older rows lacking a
-- source_id.
create index if not exists product_clips_source_url_idx
  on public.product_clips (source_url)
  where source_url is not null;

-- Sanity check: should return zero rows before the unique index is created.
-- select source_id, count(*) from public.product_clips
--   where source_id is not null group by source_id having count(*) > 1;
