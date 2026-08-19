-- Photo-first stock counting.
--
-- An agent photographs an item on the shelf and enters a quantity BEFORE the
-- product is identified. That row cannot live in `stock_count_items`, which has
-- `product_id NOT NULL` and `UNIQUE (count_id, product_id)`: an unidentified
-- photo has no product id, and two unidentified photos would collide on that
-- constraint. So captures are a staging area that BECOMES a normal count line
-- once identified, leaving the existing count and approval flow untouched.

create table if not exists stock_count_captures (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references stock_counts (id) on delete cascade,

  -- The agent's photo. This is the evidence for the whole row, so it is
  -- required - a capture without a photo is just an unidentified number.
  photo_url text not null,

  -- Quantity is captured up front, while the AI is still working.
  counted_qty integer not null check (counted_qty >= 0),

  -- Same shape as products.shelf_code, including the generated zone below, so
  -- a shelf recorded here means the same thing as a shelf recorded there.
  shelf_code text,

  -- analysing -> the vision pass is still running (or was interrupted)
  -- suggested -> candidates are ready and waiting for the agent to pick
  -- unmatched -> nothing scored above the confidence floor; needs a human
  -- resolved  -> a product was confirmed and a count line was written
  status text not null default 'analysing'
    check (status in ('analysing', 'suggested', 'unmatched', 'resolved')),

  matched_product_id uuid references products (id) on delete set null,

  -- What the AI saw and the ranked candidates it offered, kept verbatim so a
  -- wrong match can be audited afterwards rather than being unexplainable.
  ai_label text,
  ai_confidence numeric(4, 3) check (ai_confidence between 0 and 1),
  ai_candidates jsonb,
  ai_error text,

  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_by uuid references profiles (id) on delete set null,
  resolved_at timestamptz,

  -- A resolved capture must name the product it resolved to, otherwise the
  -- count line it claims to have produced cannot be traced back here.
  constraint resolved_has_product check (
    status <> 'resolved' or matched_product_id is not null
  )
);

comment on table stock_count_captures is
  'Photos counted before the product was identified. Becomes a stock_count_items row on confirmation.';

-- Derived zone, identical to products.zone so the two are comparable.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'stock_count_captures' and column_name = 'zone'
  ) then
    alter table stock_count_captures
      add column zone text
      generated always as (
        nullif(substring(upper(trim(shelf_code)) from '^[A-Z]+'), '')
      ) stored;
  end if;
end $$;

-- Reuse the products normaliser so "e2", " E2 " and "E2" cannot become three
-- different shelves depending on which screen the agent used.
drop trigger if exists trg_normalise_capture_shelf_code on stock_count_captures;
create trigger trg_normalise_capture_shelf_code
  before insert or update of shelf_code on stock_count_captures
  for each row
  execute function normalise_shelf_code();

-- The storekeeper screen reads "my open captures for this count", and the admin
-- queue reads "everything still unidentified".
create index if not exists idx_captures_count on stock_count_captures (count_id, status);
create index if not exists idx_captures_pending on stock_count_captures (status)
  where status in ('analysing', 'suggested', 'unmatched');

alter table stock_count_captures enable row level security;

-- Mirrors the stock_counts policies: any authenticated staff member can work a
-- count, and admins can resolve anything. Kept permissive-but-authenticated
-- rather than open, since these rows carry photos of the warehouse.
drop policy if exists "captures readable by authenticated" on stock_count_captures;
create policy "captures readable by authenticated"
  on stock_count_captures for select
  using (auth.uid() is not null);

drop policy if exists "captures writable by authenticated" on stock_count_captures;
create policy "captures writable by authenticated"
  on stock_count_captures for insert
  with check (auth.uid() is not null);

drop policy if exists "captures updatable by authenticated" on stock_count_captures;
create policy "captures updatable by authenticated"
  on stock_count_captures for update
  using (auth.uid() is not null);
