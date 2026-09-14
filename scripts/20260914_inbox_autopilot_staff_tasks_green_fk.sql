-- Apply only after the staff task AND native GREEN job migrations, before native activation.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.inbox_autopilot_staff_tasks
  ADD CONSTRAINT inbox_autopilot_staff_tasks_native_job_fk FOREIGN KEY(native_job_id)
  REFERENCES public.inbox_autopilot_green_jobs(id);
COMMIT;
