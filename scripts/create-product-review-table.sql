-- Tracks which products have been through the one-by-one duplicate review.
--
-- Separate from products.updated_at on purpose: "I looked at this and it has no
-- duplicate" is a judgement a person made, and it has to survive edits to the
-- product itself. Without it, a 862-product review cannot be paused.
create table if not exists product_review (
  product_id uuid primary key references products(id) on delete cascade,
  -- 'clear'  - reviewed, no duplicate in the catalogue
  -- 'merged' - reviewed and merged away (kept for the audit trail)
  -- 'skip'   - deliberately deferred, comes back at the end of the queue
  status text not null check (status in ('clear', 'merged', 'skip')),
  note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now()
);

create index if not exists product_review_status_idx on product_review(status);

-- Server-only: every read and write goes through an authenticated route using
-- the service role. Enabling RLS with no policy keeps the anon key out entirely
-- rather than relying on nobody guessing the table name.
alter table product_review enable row level security;
