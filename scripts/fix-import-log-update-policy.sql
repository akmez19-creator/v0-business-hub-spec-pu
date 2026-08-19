-- Let import runs record their own outcome.
--
-- WHY: delivery_imports had RLS enabled with only INSERT and SELECT policies.
-- The importer's final "status = completed, successful_rows = N" UPDATE was
-- therefore filtered out by RLS and matched ZERO rows - PostgREST reports that
-- as success, so the failure was completely silent. Result: all 192 import logs
-- sat at status='processing' with successful_rows=0 forever, and the Import
-- History screen could never show a finished import.
--
-- This also blocked rollback: without UPDATE we cannot stamp reverted_at, so an
-- import could never be marked as undone.
--
-- Note the existing pair uses role IN ('admin','manager'); 'owner' is included
-- here (and in the archive policy) so an owner is never locked out of undoing
-- an import they are allowed to run.

alter table delivery_imports enable row level security;

drop policy if exists delivery_imports_update_manager_plus on delivery_imports;
create policy delivery_imports_update_manager_plus
  on delivery_imports
  for update
  to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role = any (array['admin','owner','manager'])
    )
  )
  with check (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role = any (array['admin','owner','manager'])
    )
  );

-- Rollback needs to write archived rows back into deliveries and clear the
-- archive, so the archive table needs more than the read policy it shipped with.
drop policy if exists delivery_archive_admin_write on delivery_archive;
create policy delivery_archive_admin_write
  on delivery_archive
  for insert
  to authenticated
  with check (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role = any (array['admin','owner','manager'])
    )
  );

drop policy if exists delivery_archive_admin_delete on delivery_archive;
create policy delivery_archive_admin_delete
  on delivery_archive
  for delete
  to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role = any (array['admin','owner','manager'])
    )
  );
