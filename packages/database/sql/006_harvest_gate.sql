BEGIN;

CREATE OR REPLACE FUNCTION require_harvest_session_before_job_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_job_code text;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT code INTO target_job_code
  FROM public_jobs
  WHERE id=NEW.job_id;

  IF target_job_code='harvest-support' AND NOT EXISTS (
    SELECT 1
    FROM harvest_sessions session
    WHERE session.job_assignment_id=NEW.id
      AND session.status='completed'
  ) THEN
    RAISE EXCEPTION 'harvest minigame must be completed before job reward';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS harvest_session_completion_gate ON player_job_assignments;
CREATE TRIGGER harvest_session_completion_gate
BEFORE UPDATE OF status ON player_job_assignments
FOR EACH ROW
EXECUTE FUNCTION require_harvest_session_before_job_completion();

COMMIT;
