-- Local (Mauritius) purchasing, kept in its OWN tables.
--
-- WHY SEPARATE (owner's call): `purchase_orders` is structurally an IMPORT
-- record. MEASURED on the live table - 14 of its 31 columns are China-only
-- (total_payment_supplier_yuan, cbm, cbm_cost, weight_kg, carton, boxes,
-- shipment_to_warehouse, import_cp, ...) and 539 of 690 rows carry Chinese
-- text. A local invoice has none of that and instead needs VAT, discount and a
-- document reference, which the import table has nowhere to put.
--
-- The two are joined where it actually matters - `product_id` - so the cost
-- cross-check reads both. MEASURED: 682 of 690 POs carry a valid product_id,
-- so that spine is sound.
--
-- ONE RECORD TYPE: A PURCHASE (owner's instruction, "make sure its not quote
-- but purchase"). This records money actually spent, evidenced by a document
-- you import - a receipt, an invoice, a WhatsApp screenshot or a price list.
-- There is deliberately no quotation stage.

-- The quote-based draft never held data (verified: 0 rows in all four tables
-- before this ran), so it is dropped outright rather than migrated. Suppliers
-- are NOT dropped - that table is unchanged and may already hold rows.
drop table if exists local_purchase_order_lines cascade;
drop table if exists local_purchase_orders cascade;
drop table if exists local_quotation_lines cascade;
drop table if exists local_quotations cascade;

-- ---------------------------------------------------------------------------
-- Suppliers. There was NO supplier master at all: China POs only ever stored a
-- free-text `supplier_name`, which is why the same supplier appears under
-- several spellings. Local suppliers get real rows from the start - a local
-- supplier is a company you phone back, with a VAT number that has to appear
-- on the VAT return.
-- ---------------------------------------------------------------------------
create table if not exists local_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- The VAT registration number, printed on their invoice. Nullable on
  -- purpose: a non-registered supplier charges no VAT and you may still buy
  -- from them, but then NO input VAT may be claimed - the two facts travel
  -- together, so the return can be checked against this.
  vat_number text,
  brn text,
  contact_name text,
  phone text,
  email text,
  address text,
  -- Their usual settlement terms, in days. Informational.
  payment_terms_days integer,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Purchases. The document you were handed, and what it cost.
--
-- `supplier_id` is NULLABLE and `supplier_label` sits beside it: an imported
-- receipt routinely names a supplier we have no row for yet, and refusing the
-- purchase until the master is tidy would lose the evidence. The label is what
-- the paper said; the id is the link once someone makes it.
-- ---------------------------------------------------------------------------
create table if not exists local_purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references local_suppliers(id) on delete set null,
  supplier_label text,
  -- Their own document number, e.g. "INV 4471". Used to spot the same receipt
  -- being imported twice.
  doc_ref text,
  purchase_date date not null default current_date,

  -- Header-level discount as printed. Line-level overrides live on the line.
  discount_percent numeric(6,3) not null default 0
    check (discount_percent >= 0 and discount_percent <= 100),
  -- VAT rate as printed. Stored per purchase rather than hardcoded at 15% so a
  -- historical or zero-rated document stays accurate.
  vat_percent numeric(6,3) not null default 15
    check (vat_percent >= 0 and vat_percent <= 100),
  /*
   * Whether the input VAT on THIS purchase may be reclaimed from the MRA.
   *
   * EXPLICIT, never inferred at read time. Defaulted from the supplier's VAT
   * registration when one is chosen, but overridable, because a VAT-registered
   * supplier can still hand you a non-VAT receipt - and in that case nothing is
   * reclaimable no matter what their master record says.
   */
  vat_reclaimable boolean not null default false,

  currency text not null default 'MUR',

  /*
   * What the document itself declares the total to be, when it could be read.
   *
   * NOT used in any calculation. It exists to be COMPARED against the sum of
   * the lines: if a receipt totals Rs 4,830 and the imported lines only add to
   * Rs 4,200, a line was missed and the screen must say so. Without this, an
   * extraction that quietly drops a row produces a clean-looking purchase that
   * is simply wrong - and nothing on screen would ever contradict it.
   */
  document_total_gross numeric(14,2),

  -- Costs that arrive on the invoice but are not per-unit goods. Kept apart so
  -- the per-unit cost stays comparable to a China landed cost.
  delivery_charge numeric(14,2) not null default 0,
  other_charges numeric(14,2) not null default 0,

  status text not null default 'draft'
    check (status in ('draft','recorded','void')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','partial','paid')),
  paid_amount numeric(14,2) not null default 0,

  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists local_purchases_supplier_idx on local_purchases(supplier_id);
create index if not exists local_purchases_status_idx on local_purchases(status);
create index if not exists local_purchases_date_idx on local_purchases(purchase_date desc);

-- ---------------------------------------------------------------------------
-- Purchase lines. This is where the cost cross-check happens.
--
-- `product_id` IS NULLABLE AND THAT IS THE POINT. MEASURED against a real
-- 7-line document with the existing matcher: 2 lines resolved to nothing
-- ("EMS FootMassager" - the master says "EMS Foot Massager", a missing SPACE;
-- "Pest Repelling Aid" - the master says "Pest Repellent") and one resolved
-- with `exact` confidence to a DUPLICATE DECOY row: "Automatic Sweeping Robot"
-- (0 purchase orders, 1 unit of stock) instead of "Sweeping Robot" (3 purchase
-- orders, the real China cost). Auto-linking would have silently reported "no
-- import history, first time buying this" on a product we bought 1,536 units
-- of in August. So a line stays UNLINKED until a human confirms it.
-- ---------------------------------------------------------------------------
create table if not exists local_purchase_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references local_purchases(id) on delete cascade,
  -- Their wording, verbatim. Never overwritten with our own name - it is the
  -- evidence of what was actually bought, and it is how the same line is
  -- recognised on their next document.
  supplier_label text not null,
  -- Their item code (e.g. "DT1057"). MEASURED: 0 of 851 of our products carry
  -- any of these codes, so it is a reference to print back at them, never a
  -- key to match on.
  supplier_code text,
  -- NULL = not yet linked to our catalogue. See the note above.
  product_id uuid references products(id) on delete set null,
  -- How the link was made, so a bad batch can be found later.
  match_method text check (match_method in ('confirmed','created','alias','manual','unmatched')),
  matched_at timestamptz,
  matched_by uuid references profiles(id),

  qty numeric(14,3) not null default 0,
  unit text,
  -- Price per unit BEFORE any discount, exactly as printed.
  unit_price_gross numeric(14,4) not null default 0,
  -- Line discount %, overriding the purchase header when not null.
  discount_percent numeric(6,3),
  -- NET unit price = what the goods actually cost per unit, excluding VAT.
  -- GENERATED, so it can never drift from the inputs it is derived from - and
  -- this is the ONLY figure that may be compared against a China landed cost.
  unit_price_net numeric(14,4) generated always as (
    round(unit_price_gross * (1 - coalesce(discount_percent, 0) / 100.0), 4)
  ) stored,

  -- The China landed cost this line was compared against AT THE TIME of
  -- purchase, and the resulting verdict. Snapshotted deliberately: import
  -- costs move, and the question later is "was this a good decision on the
  -- information we had", which a recomputed number can no longer answer.
  china_cp_at_purchase numeric(14,4),
  variance_percent numeric(8,3),
  -- Set when the buyer went ahead despite the local price being higher. The
  -- system warns and never blocks (owner's call), so this records the choice
  -- rather than preventing it.
  override_reason text,

  notes text,
  created_at timestamptz not null default now()
);

create index if not exists local_purchase_lines_purchase_idx on local_purchase_lines(purchase_id);
create index if not exists local_purchase_lines_product_idx on local_purchase_lines(product_id);

-- ---------------------------------------------------------------------------
-- The documents a purchase was built from.
--
-- Its own table because a receipt is routinely several photos, and because the
-- raw extraction is worth keeping: when a number looks wrong months later the
-- question is always "did the reader misread it, or was the paper itself
-- wrong". `extracted` holds exactly what was read, so that stays answerable.
--
-- `purchase_id` is nullable so a document can be uploaded and read BEFORE the
-- purchase row exists - which is the normal order of events when importing.
-- ---------------------------------------------------------------------------
create table if not exists local_purchase_documents (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid references local_purchases(id) on delete cascade,
  url text not null,
  mime text,
  file_name text,
  kind text not null default 'receipt'
    check (kind in ('receipt','invoice','screenshot','pricelist','other')),
  /*
   * 'sheet' = xlsx/csv parsed cell by cell, so the values are CERTAIN.
   * 'ai'    = read from a photo or PDF by a vision model, so the values are a
   *           READING and must be reviewed before they are trusted.
   * The distinction is stored rather than guessed, because the UI has to tell
   * the owner which of the two he is looking at.
   */
  source text not null default 'ai' check (source in ('ai','sheet','manual')),
  extracted jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists local_purchase_documents_purchase_idx
  on local_purchase_documents(purchase_id);

-- ---------------------------------------------------------------------------
-- RLS. Every table here is reached through the admin client from server code,
-- and the browser must not read supplier pricing directly, so RLS is ON with
-- no permissive policy - the service role bypasses it.
-- ---------------------------------------------------------------------------
alter table local_suppliers enable row level security;
alter table local_purchases enable row level security;
alter table local_purchase_lines enable row level security;
alter table local_purchase_documents enable row level security;
