-- Physical stock count (warehouse stocktake) for the StoreKeeper module.
--
-- Why new tables instead of reusing stock_transactions:
--   stock_transactions.contractor_id is NOT NULL and its CHECK constraint only
--   allows 'stock_out' / 'stock_in'. A warehouse count belongs to no contractor,
--   so it does not fit that shape.
--
-- Counts are submitted by a storekeeper and only touch products.quantity once
-- an admin approves, so a mistyped figure cannot silently rewrite real stock.

-- Session header: one per counting run.
create table if not exists stock_counts (
  id uuid primary key default gen_random_uuid(),
  count_date date not null default current_date,
  counted_by uuid not null references profiles(id),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected')),
  notes text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references profiles(id),
  review_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- One line per product counted in a session.
create table if not exists stock_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references stock_counts(id) on delete cascade,
  product_id uuid not null references products(id),
  -- What the agent physically counted on the shelf.
  counted_qty integer not null check (counted_qty >= 0),
  -- Snapshot of products.quantity when the line was added. Frozen so the
  -- variance stays auditable even if stock moves before approval.
  system_qty integer not null default 0,
  -- True when this product had never been counted, so system_qty carries no
  -- meaning and the difference must not be reported as a real variance.
  is_baseline boolean not null default false,
  variance integer generated always as (counted_qty - system_qty) stored,
  notes text,
  created_at timestamptz default now(),
  -- A product can only be counted once per session; prevents an agent from
  -- adding the same item twice and doubling the recorded figure.
  unique (count_id, product_id)
);

create index if not exists idx_stock_counts_status on stock_counts(status);
create index if not exists idx_stock_counts_date on stock_counts(count_date desc);
create index if not exists idx_stock_count_items_count on stock_count_items(count_id);
create index if not exists idx_stock_count_items_product on stock_count_items(product_id);

-- Records when stock was last physically verified. Without this, "never counted"
-- is indistinguishable from "counted and genuinely zero" - both look like
-- quantity = 0.
alter table products add column if not exists last_counted_at timestamptz;

-- Applies an approved count in a single transaction.
--
-- Kept in SQL rather than looping from the client so that a session either
-- applies fully or not at all, and so PostgREST's 1000-row select cap cannot
-- silently truncate a large stocktake.
create or replace function approve_stock_count(
  p_count_id uuid,
  p_reviewer uuid,
  p_review_notes text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_status text;
  v_applied integer;
begin
  -- Lock the header so two reviewers cannot both apply the same count.
  select status into v_status
  from stock_counts
  where id = p_count_id
  for update;

  if v_status is null then
    return jsonb_build_object('ok', false, 'error', 'Count not found');
  end if;

  -- Idempotency guard: re-approving would re-apply the same figures.
  if v_status <> 'submitted' then
    return jsonb_build_object(
      'ok', false,
      'error', format('Count is %s, only submitted counts can be approved', v_status)
    );
  end if;

  -- The counted figure becomes the new on-hand truth.
  update products p
  set quantity = i.counted_qty,
      last_counted_at = now()
  from stock_count_items i
  where i.count_id = p_count_id
    and p.id = i.product_id;

  get diagnostics v_applied = row_count;

  update stock_counts
  set status = 'approved',
      reviewed_by = p_reviewer,
      reviewed_at = now(),
      review_notes = coalesce(p_review_notes, review_notes),
      updated_at = now()
  where id = p_count_id;

  return jsonb_build_object('ok', true, 'productsUpdated', v_applied);
end;
$$;

-- Pending review queue with variance rolled up per session, so the admin list
-- does not need to pull every line item.
create or replace function get_stock_count_summary(p_status text default null)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.count_date desc, t.created_at desc), '[]'::jsonb)
  from (
    select
      c.id,
      c.count_date,
      c.status,
      c.notes,
      c.submitted_at,
      c.reviewed_at,
      c.created_at,
      c.counted_by,
      -- profiles has `name`, not `full_name`.
      coalesce(p.name, p.email, 'Unknown') as counted_by_name,
      count(i.id)                                          as line_count,
      coalesce(sum(i.counted_qty), 0)                      as total_counted,
      -- Baseline lines are excluded from variance totals: their system_qty is
      -- meaningless, so including them would fake a huge surplus.
      coalesce(sum(i.variance) filter (where not i.is_baseline), 0) as net_variance,
      count(i.id) filter (where i.is_baseline)             as baseline_lines,
      count(i.id) filter (where not i.is_baseline and i.variance <> 0) as variance_lines
    from stock_counts c
    left join profiles p on p.id = c.counted_by
    left join stock_count_items i on i.count_id = c.id
    where p_status is null or c.status = p_status
    group by c.id, p.name, p.email
  ) t;
$$;
