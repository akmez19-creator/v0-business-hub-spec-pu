-- Allow match_method = 'auto'.
--
-- Linking is now automatic, and an automatically-made link MUST stay
-- distinguishable from one a person actually looked at - otherwise the day a
-- batch of auto-links turns out to be wrong there is no way to find them
-- ('confirmed' would be a lie about who decided).
--
-- 'auto'      the system linked it because the evidence was decisive
-- 'confirmed' a person accepted the suggestion
-- 'manual'    a person picked a different product
-- 'created'   a person created a new product for this line
-- 'alias'     matched through a learned product_aliases row
-- 'unmatched' saved with no product on purpose
alter table local_purchase_lines
  drop constraint if exists local_purchase_lines_match_method_check;

alter table local_purchase_lines
  add constraint local_purchase_lines_match_method_check
  check (match_method in ('auto','confirmed','created','alias','manual','unmatched'));
