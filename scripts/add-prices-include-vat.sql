-- Records whether a purchase document's prices ALREADY CONTAINED VAT.
--
-- Why this is needed: `local_purchase_lines.unit_price_net` is generated as
-- `unit_price_gross * (1 - discount)` with no VAT term, and price history, stock
-- valuation and the China comparison all read it as VAT-EXCLUSIVE. So a
-- VAT-inclusive document has its prices converted on entry (Rs 210 inclusive at
-- 15% is stored as Rs 182.61).
--
-- Without this flag that conversion is invisible: a later reader comparing the
-- stored Rs 182.61 against the printed invoice line of Rs 210 has no way to tell
-- a deliberate conversion from a typo. `document_total_gross` keeps the printed
-- payable total, and this says what basis the line prices were on.
--
-- Default false = "prices exclude VAT", which is how every purchase recorded
-- before today was entered, so existing rows keep their current meaning.

alter table local_purchases
  add column if not exists prices_include_vat boolean not null default false;

comment on column local_purchases.prices_include_vat is
  'True when the source document''s prices included VAT. Line prices are always STORED excluding VAT; this records what the document showed.';
