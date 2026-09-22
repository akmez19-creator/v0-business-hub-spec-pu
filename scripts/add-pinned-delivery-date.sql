-- General delivery date chosen by an admin/manager under Inbox > AI instructions.
-- While it is today or later it is the first day offered by Quick Order and the
-- AI draft; once it passes it is ignored (see activePinnedDeliveryDate).
alter table public.extension_settings
  add column if not exists pinned_delivery_date date;
