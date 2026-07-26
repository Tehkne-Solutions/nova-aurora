import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import { tradeGrossMinor, type OrderSide } from "./economy-types.js";

export type IntegrityDecision = Readonly<{
  allowed: boolean;
  reason: string | null;
  severity: "info" | "low" | "medium" | "high" | "critical";
  grossMinor: number;
  monitored: boolean;
}>;

export type IntegrityState = Readonly<{
  risk: Readonly<{
    score: number;
    level: string;
    status: string;
    reviewReason: string | null;
  }>;
  controls: readonly Readonly<{
    itemId: string;
    itemCode: string;
    itemName: string;
    assetClass: string;
    tokenizationStatus: string;
    externalTransferEnabled: boolean;
    status: string;
    referencePriceMinor: number | null;
    maxDeviationBps: number;
    maxOrderGrossMinor: number;
    maxDailyGrossMinor: number;
    maxOpenOrders: number;
    maxOrdersPerMinute: number;
    tripReason: string | null;
  }>[];
  fraudEvents: readonly Readonly<{
    id: string;
    eventType: string;
    severity: string;
    status: string;
    resourceType: string | null;
    resourceId: string | null;
    createdAt: string;
  }>[];
  changeRequests: readonly Readonly<{
    id: string;
    itemCode: string;
    changeType: string;
    status: string;
    reason: string;
    proposedBy: string;
    approvedBy: string | null;
    createdAt: string;
  }>[];
}>;

export async function evaluateMarketOrderIntegrity(
  tx: Tx,
  input: {
    ownerId: string;
    itemId: string;
    side: OrderSide;
    quantityMinor: number;
    unitPriceMinor: number;
    lock: boolean;
  }
): Promise<IntegrityDecision> {
  if (input.lock) {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`integrity:${input.ownerId}:${input.itemId}`}))`;
  }
  const rows = await tx`
    SELECT user_account.status user_status,
      COALESCE(risk.risk_score,0) risk_score,
      COALESCE(risk.risk_level,'low') risk_level,
      COALESCE(risk.economic_status,'normal') economic_status,
      control.status control_status,control.reference_price_minor,
      control.max_deviation_bps,control.max_order_gross_minor,
      control.max_daily_gross_minor,control.max_open_orders,
      control.max_orders_per_minute,control.cooldown_seconds,control.tripped_at,
      override_limit.max_order_gross_minor override_order,
      override_limit.max_daily_gross_minor override_daily,
      override_limit.max_open_orders override_open
    FROM users user_account
    LEFT JOIN user_risk_profiles risk ON risk.user_id=user_account.id
    JOIN market_controls control ON control.item_id=${input.itemId}::uuid
    LEFT JOIN economic_limit_overrides override_limit
      ON override_limit.user_id=user_account.id
      AND (override_limit.expires_at IS NULL OR override_limit.expires_at>now())
    WHERE user_account.id=${input.ownerId}::uuid
    ${input.lock ? tx`FOR UPDATE OF user_account,control,risk` : tx``}
  `;
  const row = rows[0];
  if (!row) {
    return decision(false, "Usuário ou controle de mercado não encontrado.", "high", 0, false);
  }

  if (String(row.control_status) === "tripped"
    && row.tripped_at
    && Date.now() >= new Date(String(row.tripped_at)).getTime()
      + Number(row.cooldown_seconds) * 1000) {
    if (input.lock) {
      await tx`
        UPDATE market_controls SET status='open',tripped_at=NULL,trip_reason=NULL,updated_at=now()
        WHERE item_id=${input.itemId}::uuid AND status='tripped'
      `;
      row.control_status = "open";
    }
  }

  const grossMinor = tradeGrossMinor(input.quantityMinor, input.unitPriceMinor);
  if (String(row.user_status) !== "active") {
    return decision(false, "Conta não está disponível para operações econômicas.", "high", grossMinor, false);
  }
  const economicStatus = String(row.economic_status);
  if (economicStatus === "restricted" || economicStatus === "frozen") {
    return decision(false, "Perfil econômico temporariamente restrito.", "high", grossMinor, false);
  }
  if (String(row.control_status) !== "open") {
    return decision(false, "Mercado temporariamente pausado para este ativo.", "high", grossMinor, false);
  }

  const maxOrder = Number(row.override_order ?? row.max_order_gross_minor);
  const maxDaily = Number(row.override_daily ?? row.max_daily_gross_minor);
  const maxOpen = Number(row.override_open ?? row.max_open_orders);
  if (grossMinor > maxOrder) {
    return decision(false, "Valor da ordem excede o limite por operação.", "medium", grossMinor, false);
  }

  const counters = await tx`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('open','partial'))::int open_orders,
      COUNT(*) FILTER (WHERE created_at>=now()-interval '1 minute')::int minute_orders,
      COALESCE(SUM((quantity_minor*unit_price_minor)/100)
        FILTER (WHERE created_at>=date_trunc('day',now())),0)::bigint daily_gross
    FROM market_orders WHERE owner_id=${input.ownerId}::uuid
  `;
  const counter = counters[0]!;
  if (Number(counter.open_orders) >= maxOpen) {
    return decision(false, "Quantidade máxima de ordens abertas atingida.", "medium", grossMinor, false);
  }
  if (Number(counter.minute_orders) >= Number(row.max_orders_per_minute)) {
    return decision(false, "Muitas ordens em curto intervalo.", "high", grossMinor, true);
  }
  if (Number(counter.daily_gross) + grossMinor > maxDaily) {
    return decision(false, "Limite econômico diário atingido.", "medium", grossMinor, false);
  }

  const reference = row.reference_price_minor === null
    ? null
    : Number(row.reference_price_minor);
  if (reference && reference > 0) {
    const deviationBps = Math.round(Math.abs(input.unitPriceMinor - reference) * 10_000 / reference);
    if (deviationBps > Number(row.max_deviation_bps)) {
      return decision(false, "Preço fora da faixa de proteção do mercado.", "high", grossMinor, true);
    }
  }

  const monitored = economicStatus === "monitored" || Number(row.risk_score) >= 300;
  return decision(true, null, monitored ? "medium" : "info", grossMinor, monitored);
}

export async function recordTradeSurveillance(
  tx: Tx,
  input: {
    tradeId: string;
    itemId: string;
    buyerId: string;
    sellerId: string;
    unitPriceMinor: number;
    grossMinor: number;
  }
): Promise<void> {
  const controls = await tx`
    SELECT reference_price_minor,max_deviation_bps,status
    FROM market_controls WHERE item_id=${input.itemId}::uuid FOR UPDATE
  `;
  const control = controls[0];
  if (!control) return;
  const reference = control.reference_price_minor === null
    ? null
    : Number(control.reference_price_minor);
  const deviationBps = reference && reference > 0
    ? Math.round(Math.abs(input.unitPriceMinor - reference) * 10_000 / reference)
    : 0;

  if (reference && deviationBps > Number(control.max_deviation_bps)) {
    await tx`
      UPDATE market_controls SET status='tripped',tripped_at=now(),
        trip_reason=${`Trade desviou ${deviationBps} bps da referência.`},updated_at=now()
      WHERE item_id=${input.itemId}::uuid
    `;
    await tx`
      INSERT INTO market_integrity_events (
        id,item_id,event_type,severity,action,trade_id,details
      ) VALUES (
        ${randomUUID()}::uuid,${input.itemId}::uuid,'price-circuit-breaker','critical','trip',
        ${input.tradeId}::uuid,
        ${JSON.stringify({ deviationBps, referencePriceMinor: reference, unitPriceMinor: input.unitPriceMinor })}::jsonb
      )
    `;
  } else {
    const nextReference = reference
      ? Math.round(reference * 0.8 + input.unitPriceMinor * 0.2)
      : input.unitPriceMinor;
    await tx`
      UPDATE market_controls SET reference_price_minor=${nextReference},updated_at=now()
      WHERE item_id=${input.itemId}::uuid
    `;
  }

  const reciprocal = await tx`
    SELECT COUNT(*)::int trade_count
    FROM market_trades
    WHERE created_at>=now()-interval '10 minutes'
      AND ((buyer_id=${input.buyerId}::uuid AND seller_id=${input.sellerId}::uuid)
        OR (buyer_id=${input.sellerId}::uuid AND seller_id=${input.buyerId}::uuid))
  `;
  if (Number(reciprocal[0]?.trade_count ?? 0) >= 5) {
    for (const userId of [input.buyerId,input.sellerId]) {
      await tx`
        INSERT INTO fraud_events (
          id,user_id,event_type,severity,score_delta,source,resource_type,resource_id,metadata
        ) VALUES (
          ${randomUUID()}::uuid,${userId}::uuid,'reciprocal-trading-pattern','high',120,
          'market-surveillance','trade',${input.tradeId},
          ${JSON.stringify({ counterpart: userId === input.buyerId ? input.sellerId : input.buyerId })}::jsonb
        )
      `;
      await tx`
        INSERT INTO user_risk_profiles (user_id,risk_score,risk_level,economic_status,review_reason)
        VALUES (${userId}::uuid,120,'medium','monitored','reciprocal-trading-pattern')
        ON CONFLICT (user_id) DO UPDATE SET
          risk_score=LEAST(1000,user_risk_profiles.risk_score+120),
          risk_level=CASE WHEN user_risk_profiles.risk_score+120>=600 THEN 'high' ELSE 'medium' END,
          economic_status=CASE WHEN user_risk_profiles.risk_score+120>=800 THEN 'restricted' ELSE 'monitored' END,
          review_reason='reciprocal-trading-pattern',last_evaluated_at=now(),updated_at=now()
      `;
    }
  }
}

function decision(
  allowed: boolean,
  reason: string | null,
  severity: IntegrityDecision["severity"],
  grossMinor: number,
  monitored: boolean
): IntegrityDecision {
  return { allowed, reason, severity, grossMinor, monitored };
}

export class EconomyIntegrityService extends EconomyRepositoryBase {
  async preflightOrder(input: {
    ownerId: string;
    itemId: string;
    side: OrderSide;
    quantityMinor: number;
    unitPriceMinor: number;
  }): Promise<IntegrityDecision> {
    return this.sql.begin(async (tx) => evaluateMarketOrderIntegrity(tx, { ...input, lock: false }));
  }

  async recordOrderDecision(input: {
    ownerId: string;
    itemId: string;
    orderId?: string | undefined;
    decision: IntegrityDecision;
    details: unknown;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`
        INSERT INTO market_integrity_events (
          id,item_id,user_id,event_type,severity,action,order_id,details
        ) VALUES (
          ${randomUUID()}::uuid,${input.itemId}::uuid,${input.ownerId}::uuid,
          ${input.decision.allowed ? 'order-allowed' : 'order-denied'},
          ${input.decision.severity},${input.decision.allowed ? 'allow' : 'deny'},
          ${input.orderId ?? null}::uuid,
          ${JSON.stringify({ reason: input.decision.reason, ...asRecord(input.details) })}::jsonb
        )
      `;
      if (!input.decision.allowed && input.decision.monitored) {
        await tx`
          INSERT INTO fraud_events (
            id,user_id,event_type,severity,score_delta,source,resource_type,resource_id,metadata
          ) VALUES (
            ${randomUUID()}::uuid,${input.ownerId}::uuid,'market-order-velocity-or-price',
            ${input.decision.severity},60,'market-preflight','market-order',${input.orderId ?? null},
            ${JSON.stringify({ reason: input.decision.reason, ...asRecord(input.details) })}::jsonb
          )
        `;
        await tx`
          INSERT INTO user_risk_profiles (user_id,risk_score,risk_level,economic_status,review_reason)
          VALUES (${input.ownerId}::uuid,60,'medium','monitored',${input.decision.reason})
          ON CONFLICT (user_id) DO UPDATE SET
            risk_score=LEAST(1000,user_risk_profiles.risk_score+60),
            risk_level=CASE WHEN user_risk_profiles.risk_score+60>=600 THEN 'high' ELSE 'medium' END,
            economic_status=CASE WHEN user_risk_profiles.risk_score+60>=800 THEN 'restricted' ELSE 'monitored' END,
            review_reason=${input.decision.reason},last_evaluated_at=now(),updated_at=now()
        `;
      }
    });
  }

  async state(userId: string, administrative = false): Promise<IntegrityState> {
    const [riskRows, controls, fraudEvents, changes] = await Promise.all([
      this.sql`
        SELECT risk_score,risk_level,economic_status,review_reason
        FROM user_risk_profiles WHERE user_id=${userId}::uuid
      `,
      this.sql`
        SELECT control.*,item.code item_code,item.name item_name,item.asset_class,
          item.tokenization_status,item.external_transfer_enabled
        FROM market_controls control JOIN items item ON item.id=control.item_id
        ORDER BY item.code
      `,
      administrative
        ? this.sql`
            SELECT id,event_type,severity,status,resource_type,resource_id,created_at
            FROM fraud_events WHERE status IN ('open','reviewing')
            ORDER BY created_at DESC LIMIT 200
          `
        : this.sql`
            SELECT id,event_type,severity,status,resource_type,resource_id,created_at
            FROM fraud_events WHERE user_id=${userId}::uuid
            ORDER BY created_at DESC LIMIT 100
          `,
      administrative
        ? this.sql`
            SELECT request.id,item.code item_code,request.change_type,request.status,
              request.reason,proposer.display_name proposed_by,
              approver.display_name approved_by,request.created_at
            FROM market_control_change_requests request
            JOIN items item ON item.id=request.item_id
            JOIN users proposer ON proposer.id=request.proposed_by
            LEFT JOIN users approver ON approver.id=request.approved_by
            ORDER BY request.created_at DESC LIMIT 100
          `
        : Promise.resolve([])
    ]);
    const risk = riskRows[0];
    return {
      risk: {
        score: Number(risk?.risk_score ?? 0),
        level: String(risk?.risk_level ?? "low"),
        status: String(risk?.economic_status ?? "normal"),
        reviewReason: risk?.review_reason ? String(risk.review_reason) : null
      },
      controls: controls.map((row) => ({
        itemId: String(row.item_id),
        itemCode: String(row.item_code),
        itemName: String(row.item_name),
        assetClass: String(row.asset_class),
        tokenizationStatus: String(row.tokenization_status),
        externalTransferEnabled: Boolean(row.external_transfer_enabled),
        status: String(row.status),
        referencePriceMinor: row.reference_price_minor === null ? null : Number(row.reference_price_minor),
        maxDeviationBps: Number(row.max_deviation_bps),
        maxOrderGrossMinor: Number(row.max_order_gross_minor),
        maxDailyGrossMinor: Number(row.max_daily_gross_minor),
        maxOpenOrders: Number(row.max_open_orders),
        maxOrdersPerMinute: Number(row.max_orders_per_minute),
        tripReason: row.trip_reason ? String(row.trip_reason) : null
      })),
      fraudEvents: fraudEvents.map((row) => ({
        id: String(row.id),
        eventType: String(row.event_type),
        severity: String(row.severity),
        status: String(row.status),
        resourceType: row.resource_type ? String(row.resource_type) : null,
        resourceId: row.resource_id ? String(row.resource_id) : null,
        createdAt: new Date(String(row.created_at)).toISOString()
      })),
      changeRequests: changes.map((row) => ({
        id: String(row.id),
        itemCode: String(row.item_code),
        changeType: String(row.change_type),
        status: String(row.status),
        reason: String(row.reason),
        proposedBy: String(row.proposed_by),
        approvedBy: row.approved_by ? String(row.approved_by) : null,
        createdAt: new Date(String(row.created_at)).toISOString()
      }))
    };
  }

  async proposeChange(input: {
    actorId: string;
    itemCode: string;
    changeType: "limits" | "pause" | "resume" | "reset-reference" | "asset-classification";
    payload: Record<string, unknown>;
    reason: string;
  }): Promise<string> {
    const items = await this.sql`SELECT id FROM items WHERE code=${input.itemCode}`;
    if (!items[0]) throw new Error("Ativo não encontrado.");
    const id = randomUUID();
    await this.sql`
      INSERT INTO market_control_change_requests (
        id,item_id,proposed_by,change_type,payload,reason
      ) VALUES (
        ${id}::uuid,${String(items[0].id)}::uuid,${input.actorId}::uuid,
        ${input.changeType},${JSON.stringify(input.payload)}::jsonb,${input.reason.slice(0,1000)}
      )
    `;
    return id;
  }

  async approveChange(input: { actorId: string; requestId: string }): Promise<void> {
    await this.sql.begin("isolation level serializable", async (tx) => {
      const rows = await tx`
        SELECT * FROM market_control_change_requests
        WHERE id=${input.requestId}::uuid AND status='proposed' FOR UPDATE
      `;
      const request = rows[0];
      if (!request) throw new Error("Solicitação não encontrada ou já processada.");
      if (String(request.proposed_by) === input.actorId) {
        throw new Error("A mesma pessoa não pode propor e aprovar a mudança.");
      }
      const payload = request.payload as Record<string, unknown>;
      const itemId = String(request.item_id);
      const type = String(request.change_type);
      if (type === "pause") {
        await tx`
          UPDATE market_controls SET status='paused',trip_reason=${String(payload.reason ?? request.reason)},
            updated_by=${input.actorId}::uuid,updated_at=now() WHERE item_id=${itemId}::uuid
        `;
      } else if (type === "resume") {
        await tx`
          UPDATE market_controls SET status='open',tripped_at=NULL,trip_reason=NULL,
            updated_by=${input.actorId}::uuid,updated_at=now() WHERE item_id=${itemId}::uuid
        `;
      } else if (type === "reset-reference") {
        const reference = Number(payload.referencePriceMinor);
        if (!Number.isSafeInteger(reference) || reference <= 0) throw new Error("Referência inválida.");
        await tx`
          UPDATE market_controls SET reference_price_minor=${reference},status='open',
            tripped_at=NULL,trip_reason=NULL,updated_by=${input.actorId}::uuid,updated_at=now()
          WHERE item_id=${itemId}::uuid
        `;
      } else if (type === "limits") {
        await tx`
          UPDATE market_controls SET
            max_deviation_bps=COALESCE(${numberOrNull(payload.maxDeviationBps)},max_deviation_bps),
            max_order_gross_minor=COALESCE(${numberOrNull(payload.maxOrderGrossMinor)},max_order_gross_minor),
            max_daily_gross_minor=COALESCE(${numberOrNull(payload.maxDailyGrossMinor)},max_daily_gross_minor),
            max_open_orders=COALESCE(${numberOrNull(payload.maxOpenOrders)},max_open_orders),
            max_orders_per_minute=COALESCE(${numberOrNull(payload.maxOrdersPerMinute)},max_orders_per_minute),
            updated_by=${input.actorId}::uuid,updated_at=now()
          WHERE item_id=${itemId}::uuid
        `;
      } else if (type === "asset-classification") {
        const assetClass = String(payload.assetClass ?? "");
        const tokenizationStatus = String(payload.tokenizationStatus ?? "not-tokenized");
        const externalTransferEnabled = payload.externalTransferEnabled === true;
        if (externalTransferEnabled && tokenizationStatus !== "enabled") {
          throw new Error("Transferência externa exige tokenização habilitada.");
        }
        await tx`
          UPDATE items SET asset_class=${assetClass},tokenization_status=${tokenizationStatus},
            external_transfer_enabled=${externalTransferEnabled},
            blockchain_network=${payload.blockchainNetwork ? String(payload.blockchainNetwork) : null},
            legal_classification=${String(payload.legalClassification ?? 'virtual-game-asset')}
          WHERE id=${itemId}::uuid
        `;
      }
      await tx`
        UPDATE market_control_change_requests SET status='applied',approved_by=${input.actorId}::uuid,
          approved_at=now(),applied_at=now() WHERE id=${input.requestId}::uuid
      `;
    });
  }

  async reviewUser(input: {
    actorId: string;
    userId: string;
    status: "normal" | "monitored" | "restricted" | "frozen";
    score: number;
    reason: string;
  }): Promise<void> {
    const score = Math.min(Math.max(Math.trunc(input.score),0),1000);
    const level = score >= 800 ? "critical" : score >= 600 ? "high" : score >= 300 ? "medium" : "low";
    await this.sql`
      INSERT INTO user_risk_profiles (
        user_id,risk_score,risk_level,economic_status,review_reason,last_evaluated_at,updated_at
      ) VALUES (
        ${input.userId}::uuid,${score},${level},${input.status},${input.reason.slice(0,1000)},now(),now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        risk_score=EXCLUDED.risk_score,risk_level=EXCLUDED.risk_level,
        economic_status=EXCLUDED.economic_status,review_reason=EXCLUDED.review_reason,
        last_evaluated_at=now(),updated_at=now()
    `;
  }

  async resolveFraudEvent(input: {
    actorId: string;
    eventId: string;
    status: "resolved" | "false-positive";
  }): Promise<void> {
    const rows = await this.sql`
      UPDATE fraud_events SET status=${input.status},resolved_at=now(),resolved_by=${input.actorId}::uuid
      WHERE id=${input.eventId}::uuid AND status IN ('open','reviewing') RETURNING id
    `;
    if (!rows[0]) throw new Error("Evento não encontrado ou já resolvido.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
