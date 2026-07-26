BEGIN;

CREATE OR REPLACE FUNCTION enforce_market_order_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  control_record market_controls%ROWTYPE;
  risk_record user_risk_profiles%ROWTYPE;
  override_record economic_limit_overrides%ROWTYPE;
  calculated_gross bigint;
  allowed_order bigint;
  allowed_daily bigint;
  allowed_open integer;
  open_count integer;
  minute_count integer;
  daily_gross bigint;
  deviation_bps bigint;
  owner_status text;
BEGIN
  SELECT status INTO owner_status FROM users WHERE id=NEW.owner_id FOR UPDATE;
  IF owner_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Conta não está disponível para operações econômicas.' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO control_record FROM market_controls
  WHERE item_id=NEW.item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Controle de integridade ausente para o ativo.' USING ERRCODE='P0001';
  END IF;

  IF control_record.status='tripped'
    AND control_record.tripped_at IS NOT NULL
    AND control_record.tripped_at
      + make_interval(secs=>control_record.cooldown_seconds)<=now() THEN
    UPDATE market_controls SET
      status='open',tripped_at=NULL,trip_reason=NULL,updated_at=now()
    WHERE item_id=NEW.item_id;
    control_record.status:='open';
  END IF;

  IF control_record.status<>'open' THEN
    RAISE EXCEPTION 'Mercado temporariamente pausado para este ativo.' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO risk_record FROM user_risk_profiles
  WHERE user_id=NEW.owner_id FOR UPDATE;
  IF FOUND AND risk_record.economic_status IN ('restricted','frozen') THEN
    RAISE EXCEPTION 'Perfil econômico temporariamente restrito.' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO override_record FROM economic_limit_overrides
  WHERE user_id=NEW.owner_id AND (expires_at IS NULL OR expires_at>now());

  calculated_gross := (NEW.quantity_minor*NEW.unit_price_minor)/100;
  allowed_order := COALESCE(override_record.max_order_gross_minor,control_record.max_order_gross_minor);
  allowed_daily := COALESCE(override_record.max_daily_gross_minor,control_record.max_daily_gross_minor);
  allowed_open := COALESCE(override_record.max_open_orders,control_record.max_open_orders);

  IF calculated_gross>allowed_order THEN
    RAISE EXCEPTION 'Valor da ordem excede o limite por operação.' USING ERRCODE='P0001';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status IN ('open','partial'))::integer,
    COUNT(*) FILTER (WHERE created_at>=now()-interval '1 minute')::integer,
    COALESCE(SUM((quantity_minor*unit_price_minor)/100)
      FILTER (WHERE created_at>=date_trunc('day',now())),0)::bigint
  INTO open_count,minute_count,daily_gross
  FROM market_orders WHERE owner_id=NEW.owner_id;

  IF open_count>=allowed_open THEN
    RAISE EXCEPTION 'Quantidade máxima de ordens abertas atingida.' USING ERRCODE='P0001';
  END IF;
  IF minute_count>=control_record.max_orders_per_minute THEN
    RAISE EXCEPTION 'Muitas ordens em curto intervalo.' USING ERRCODE='P0001';
  END IF;
  IF daily_gross+calculated_gross>allowed_daily THEN
    RAISE EXCEPTION 'Limite econômico diário atingido.' USING ERRCODE='P0001';
  END IF;

  IF control_record.reference_price_minor IS NOT NULL
    AND control_record.reference_price_minor>0 THEN
    deviation_bps := ABS(NEW.unit_price_minor-control_record.reference_price_minor)
      *10000/control_record.reference_price_minor;
    IF deviation_bps>control_record.max_deviation_bps THEN
      RAISE EXCEPTION 'Preço fora da faixa de proteção do mercado.' USING ERRCODE='P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS market_order_integrity_guard ON market_orders;
CREATE TRIGGER market_order_integrity_guard
BEFORE INSERT ON market_orders
FOR EACH ROW EXECUTE FUNCTION enforce_market_order_integrity();

COMMENT ON TRIGGER market_order_integrity_guard ON market_orders IS
  'Última barreira transacional contra ordens fora dos limites de integridade.';

COMMIT;
