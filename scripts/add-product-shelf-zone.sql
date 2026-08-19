-- Product shelf location.
--
-- Products live on shelves labelled like "E1": the letter prefix is the ZONE
-- ("E") and the number is the shelf within that zone ("1").
--
-- Only `shelf_code` is stored. `zone` is a GENERATED column derived from it, so
-- the two can never drift out of sync - there is no way to save a product on
-- shelf "E1" while its zone says "B". Storing zone separately would create
-- exactly that class of bug.

alter table products
  add column if not exists shelf_code text;

comment on column products.shelf_code is
  'Shelf label, e.g. "E1". Letter prefix is the zone. NULL = location not recorded.';

-- Derived zone: the leading letters of the shelf code.
-- upper() and substring(text, text) are both immutable, so this is valid in a
-- STORED generated column.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'products' and column_name = 'zone'
  ) then
    alter table products
      add column zone text
      generated always as (
        nullif(substring(upper(trim(shelf_code)) from '^[A-Z]+'), '')
      ) stored;
  end if;
end $$;

comment on column products.zone is
  'Derived from shelf_code (letter prefix). Generated - never write to this directly.';

-- Normalise shelf codes on the way in, whatever the entry path (inline edit,
-- stock count, Excel import). Without this, "e1", " E1 " and "E1" become three
-- different-looking labels for one shelf and the zone grouping fragments.
create or replace function normalise_shelf_code()
returns trigger
language plpgsql
as $$
begin
  if new.shelf_code is not null then
    -- Collapse internal whitespace, strip surrounding space, force upper case.
    new.shelf_code := upper(regexp_replace(btrim(new.shelf_code), '\s+', '', 'g'));
    -- Treat an emptied field as "no location" rather than an empty string, so
    -- `shelf_code IS NULL` is the single test for unset everywhere.
    if new.shelf_code = '' then
      new.shelf_code := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_normalise_shelf_code on products;
create trigger trg_normalise_shelf_code
  before insert or update of shelf_code on products
  for each row
  execute function normalise_shelf_code();

-- Zone lookups drive grouping and the "walk the warehouse in order" sort.
create index if not exists idx_products_zone on products (zone);
create index if not exists idx_products_shelf_code on products (shelf_code);
