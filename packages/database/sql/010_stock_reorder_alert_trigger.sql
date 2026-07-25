BEGIN;

CREATE OR REPLACE FUNCTION sync_business_stock_reorder_alert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_company_id uuid;
  target_code text;
  target_severity text;
  target_message text;
BEGIN
  SELECT company_id
  INTO target_company_id
  FROM property_buildings
  WHERE id = NEW.building_id;

  IF target_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  target_code := 'stock-low:' || NEW.building_id::text;

  IF NEW.quantity_units <= NEW.reorder_point THEN
    target_severity := CASE
      WHEN NEW.quantity_units = 0 THEN 'critical'
      ELSE 'warning'
    END;
    target_message := CASE
      WHEN NEW.quantity_units = 0
        THEN 'Estoque comercial esgotado. Reposição B2B necessária.'
      ELSE 'Estoque abaixo do ponto de reposição.'
    END;

    INSERT INTO business_alerts (
      id, company_id, building_id, code, severity, message
    ) VALUES (
      gen_random_uuid(),
      target_company_id,
      NEW.building_id,
      target_code,
      target_severity,
      target_message
    )
    ON CONFLICT (company_id, code) WHERE status = 'open'
    DO UPDATE SET
      severity = EXCLUDED.severity,
      message = EXCLUDED.message;
  ELSE
    UPDATE business_alerts
    SET status = 'resolved'
    WHERE company_id = target_company_id
      AND code = target_code
      AND status = 'open';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS business_stock_reorder_alert_trigger
  ON business_stock_levels;

CREATE CONSTRAINT TRIGGER business_stock_reorder_alert_trigger
AFTER INSERT OR UPDATE
ON business_stock_levels
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sync_business_stock_reorder_alert();

COMMIT;
