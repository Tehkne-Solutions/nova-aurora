import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import {
  calculateContinuousCoverageMinutes
} from "./moderation-operations-rules.js";
import {
  evaluateControlledBetaReadiness,
  evaluateRolloutObservation,
  type ControlledBetaReadiness,
  type RolloutDecision
} from "./controlled-beta-rules.js";

export type BetaWaveView = Readonly<{
  id: string;
  waveKey: string;
  label: string;
  status: string;
  targetPercent: number;
  maxActivations: number;
  eligibility: unknown;
  thresholds: unknown;
  startsAt: string | null;
  endsAt: string | null;
  activatedAt: string | null;
  completedAt: string | null;
  rollbackReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  members: number;
  activeMembers: number;
}>;

export type BetaControlView = Readonly<{
  mode: string;
  status: string;
  killSwitch: boolean;
  activeWaveId: string | null;
  thresholds: unknown;
  reason: string | null;
  updatedAt: string;
}>;

type Thresholds = Readonly<{
  maxErrorRatePercent: number;
  maxP95LatencyMs: number;
  maxCriticalReports: number;
}>;

type WaveEligibility = Readonly<{
  trustReady: boolean;
  minimumAccountAgeDays: number;
  requireMfa: boolean;
}>;

function iso(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}

function rolloutMode(): "open" | "controlled" | "closed" {
  const configured = process.env.BETA_ROLLOUT_MODE;
  if (configured === "open" || configured === "controlled" || configured === "closed") {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "controlled" : "open";
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function thresholds(value: unknown, fallback?: Thresholds): Thresholds {
  const source = (
    value && typeof value === "object" ? value : {}
  ) as Record<string, unknown>;
  const base = fallback ?? {
    maxErrorRatePercent: 2,
    maxP95LatencyMs: 1200,
    maxCriticalReports: 0
  };
  return {
    maxErrorRatePercent: finiteNumber(
      source.maxErrorRatePercent,
      base.maxErrorRatePercent
    ),
    maxP95LatencyMs: finiteNumber(
      source.maxP95LatencyMs,
      base.maxP95LatencyMs
    ),
    maxCriticalReports: finiteNumber(
      source.maxCriticalReports,
      base.maxCriticalReports
    )
  };
}

function eligibility(value: unknown): WaveEligibility {
  const source = (
    value && typeof value === "object" ? value : {}
  ) as Record<string, unknown>;
  return {
    trustReady: source.trustReady !== false,
    minimumAccountAgeDays: Math.max(
      0,
      Math.floor(finiteNumber(source.minimumAccountAgeDays, 0))
    ),
    requireMfa: source.requireMfa === true
  };
}

export class ControlledBetaService extends EconomyRepositoryBase {
  async assertPlayerAccess(userId: string): Promise<void> {
    const mode = rolloutMode();
    if (mode === "open") return;
    if (mode === "closed") {
      throw new Error("O beta está temporariamente fechado.");
    }

    const rows = await this.sql`
      SELECT account.beta_activation_state,control.status,control.kill_switch
      FROM users account
      CROSS JOIN beta_rollout_control control
      WHERE account.id=${userId}::uuid
        AND control.control_key='public-beta'
    `;
    const row = rows[0];
    if (!row) throw new Error("Controle de ativação não encontrado.");
    if (Boolean(row.kill_switch) || String(row.status) !== "running") {
      throw new Error("A onda controlada está pausada.");
    }
    if (String(row.beta_activation_state) !== "active") {
      throw new Error("Esta conta ainda não foi ativada em uma onda do beta.");
    }
  }

  async createWave(input: {
    actorId: string;
    label: string;
    targetPercent: number;
    maxActivations: number;
    eligibility: unknown;
    thresholds: unknown;
    startsAt?: string | undefined;
    endsAt?: string | undefined;
    idempotencyKey: string;
  }): Promise<BetaWaveView> {
    if (input.startsAt && input.endsAt
      && new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) {
      throw new Error("O término da onda deve ocorrer após o início.");
    }

    return this.idempotent(
      `beta-wave:${input.idempotencyKey}`,
      input.actorId,
      input,
      async (tx) => {
        const id = randomUUID();
        const key = `WAVE-${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
        const rows = await tx`
          INSERT INTO beta_rollout_waves (
            id,wave_key,label,target_percent,max_activations,eligibility,thresholds,
            starts_at,ends_at,created_by,updated_by
          ) VALUES (
            ${id}::uuid,
            ${key},
            ${input.label.slice(0,160)},
            ${input.targetPercent},
            ${input.maxActivations},
            ${JSON.stringify(input.eligibility)}::jsonb,
            ${JSON.stringify(input.thresholds)}::jsonb,
            ${input.startsAt ?? null},
            ${input.endsAt ?? null},
            ${input.actorId}::uuid,
            ${input.actorId}::uuid
          )
          RETURNING *
        `;
        await this.syncGateTx(tx, input.actorId);
        return this.mapWave(rows[0], 0, 0);
      }
    );
  }

  async approveWave(input: {
    actorId: string;
    waveId: string;
    reason: string;
  }): Promise<void> {
    await this.sql.begin("isolation level serializable", async (tx) => {
      const rows = await tx`
        SELECT created_by,status
        FROM beta_rollout_waves
        WHERE id=${input.waveId}::uuid
        FOR UPDATE
      `;
      const memberRows = await tx`
        SELECT count(*)::int members
        FROM beta_wave_members
        WHERE wave_id=${input.waveId}::uuid
      `;
      const wave = rows[0]
        ? { ...rows[0], members: Number(memberRows[0]?.members ?? 0) }
        : undefined;
      if (!wave || String(wave.status) !== "planned") {
        throw new Error("Somente uma onda planejada pode ser aprovada.");
      }
      if (String(wave.created_by) === input.actorId) {
        throw new Error("A onda precisa de aprovação independente do criador.");
      }
      if (Number(memberRows[0]?.members ?? 0) < 1) {
        throw new Error("Inclua ao menos um membro elegível antes da aprovação.");
      }

      await tx`
        UPDATE beta_rollout_waves SET
          approved_by=${input.actorId}::uuid,
          approved_at=now(),
          updated_by=${input.actorId}::uuid,
          updated_at=now()
        WHERE id=${input.waveId}::uuid
      `;
      await this.event(
        tx,
        input.waveId,
        "wave-approved",
        "planned",
        "planned",
        input.reason,
        {},
        input.actorId
      );
      await this.syncGateTx(tx, input.actorId);
    });
  }

  async enrollUsers(input: {
    actorId: string;
    waveId: string;
    userIds: readonly string[];
  }): Promise<Readonly<{
    enrolled: number;
    activated: number;
    eligiblePopulation: number;
    capacity: number;
  }>> {
    const unique = [...new Set(input.userIds)].slice(0, 1000);
    if (unique.length === 0) throw new Error("Informe ao menos um usuário.");

    return this.sql.begin("isolation level serializable", async (tx) => {
      const waves = await tx`
        SELECT id,status,max_activations,target_percent,eligibility
        FROM beta_rollout_waves
        WHERE id=${input.waveId}::uuid
          AND status IN ('planned','active','paused')
        FOR UPDATE
      `;
      const wave = waves[0];
      if (!wave) throw new Error("Onda não encontrada ou encerrada.");

      const policy = eligibility(wave.eligibility);
      const eligiblePopulation = await this.eligiblePopulation(tx, policy);
      const percentageCapacity = eligiblePopulation === 0
        ? 0
        : Math.max(
            1,
            Math.ceil(
              eligiblePopulation * Number(wave.target_percent) / 100
            )
          );
      const capacity = Math.min(
        Number(wave.max_activations),
        percentageCapacity
      );
      if (capacity < 1) {
        throw new Error("Não existe população elegível para esta onda.");
      }

      const counts = await tx`
        SELECT count(*)::int total
        FROM beta_wave_members
        WHERE wave_id=${input.waveId}::uuid
      `;
      const remaining = capacity - Number(counts[0]?.total ?? 0);
      if (remaining <= 0) {
        throw new Error(
          "O limite percentual ou absoluto desta onda foi atingido."
        );
      }

      const candidates = await this.eligibleCandidates(
        tx,
        unique,
        policy,
        remaining
      );
      let enrolled = 0;
      let activated = 0;
      const active = String(wave.status) === "active";

      for (const candidate of candidates) {
        const userId = String(candidate.id);
        const inserted = await tx`
          INSERT INTO beta_wave_members (
            wave_id,user_id,status,previous_activation_state,
            enrolled_by,activated_at
          ) VALUES (
            ${input.waveId}::uuid,
            ${userId}::uuid,
            ${active ? "active" : "pending"},
            ${String(candidate.beta_activation_state)},
            ${input.actorId}::uuid,
            ${active ? new Date().toISOString() : null}
          )
          ON CONFLICT (wave_id,user_id) DO NOTHING
          RETURNING user_id
        `;
        if (!inserted[0]) continue;

        enrolled += 1;
        if (active) activated += 1;
        await tx`
          UPDATE users SET
            beta_activation_state=${active ? "active" : "pending"},
            beta_activation_updated_at=now(),
            updated_at=now()
          WHERE id=${userId}::uuid
        `;
      }

      await this.syncGateTx(tx, input.actorId);
      return { enrolled, activated, eligiblePopulation, capacity };
    });
  }

  async startWave(input: {
    actorId: string;
    waveId: string;
    reason: string;
  }): Promise<void> {
    await this.sql.begin("isolation level serializable", async (tx) => {
      await this.assertStartConditions(tx, input.waveId);
      const rows = await tx`
        UPDATE beta_rollout_waves SET
          status='active',
          activated_at=COALESCE(activated_at,now()),
          updated_by=${input.actorId}::uuid,
          updated_at=now()
        WHERE id=${input.waveId}::uuid
          AND status IN ('planned','paused')
        RETURNING id
      `;
      if (!rows[0]) {
        throw new Error("Onda não encontrada ou não pode ser iniciada.");
      }

      await tx`
        UPDATE beta_rollout_waves SET status='paused',updated_at=now()
        WHERE id<>${input.waveId}::uuid AND status='active'
      `;
      const controls = await tx`
        UPDATE beta_rollout_control SET
          status='running',
          active_wave_id=${input.waveId}::uuid,
          reason=${input.reason.slice(0,1000)},
          updated_by=${input.actorId}::uuid,
          updated_at=now()
        WHERE control_key='public-beta'
          AND kill_switch=false
        RETURNING control_key
      `;
      if (!controls[0]) {
        throw new Error("O kill switch precisa ser desarmado explicitamente.");
      }

      await tx`
        UPDATE beta_wave_members SET
          status='active',
          activated_at=COALESCE(activated_at,now())
        WHERE wave_id=${input.waveId}::uuid
          AND status IN ('pending','paused')
      `;
      await tx`
        UPDATE users account SET
          beta_activation_state='active',
          beta_activation_updated_at=now(),
          updated_at=now()
        FROM beta_wave_members member
        WHERE member.wave_id=${input.waveId}::uuid
          AND member.user_id=account.id
          AND member.status='active'
      `;
      await this.event(
        tx,
        input.waveId,
        "wave-started",
        null,
        "active",
        input.reason,
        {},
        input.actorId
      );
    });
  }

  async pauseWave(input: {
    actorId: string;
    waveId: string;
    reason: string;
    killSwitch?: boolean | undefined;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await this.pauseTx(
        tx,
        input.waveId,
        input.actorId,
        input.reason,
        input.killSwitch ?? false
      );
    });
  }

  async rollbackWave(input: {
    actorId: string;
    waveId: string;
    reason: string;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await this.rollbackTx(tx, input.waveId, input.actorId, input.reason);
    });
  }

  async completeWave(input: {
    actorId: string;
    waveId: string;
    reason: string;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE beta_rollout_waves SET
          status='completed',
          completed_at=now(),
          updated_by=${input.actorId}::uuid,
          updated_at=now()
        WHERE id=${input.waveId}::uuid
          AND status='active'
        RETURNING id
      `;
      if (!rows[0]) throw new Error("Onda ativa não encontrada.");

      await tx`
        UPDATE beta_wave_members SET status='completed'
        WHERE wave_id=${input.waveId}::uuid
          AND status='active'
      `;
      await tx`
        UPDATE beta_rollout_control SET
          status='paused',
          active_wave_id=NULL,
          reason=${input.reason.slice(0,1000)},
          updated_by=${input.actorId}::uuid,
          updated_at=now()
        WHERE control_key='public-beta'
      `;
      await this.event(
        tx,
        input.waveId,
        "wave-completed",
        "active",
        "completed",
        input.reason,
        {},
        input.actorId
      );
      await this.syncGateTx(tx, input.actorId);
    });
  }

  async recordObservation(input: {
    actorId: string;
    waveId?: string | undefined;
    errorRatePercent: number;
    p95LatencyMs: number;
    criticalReports: number;
    activeUsers: number;
    metadata?: unknown;
  }): Promise<Readonly<{
    decision: RolloutDecision;
    reasons: readonly string[];
  }>> {
    return this.sql.begin(async (tx) => {
      const controlRows = await tx`
        SELECT active_wave_id,thresholds
        FROM beta_rollout_control
        WHERE control_key='public-beta'
        FOR UPDATE
      `;
      const control = controlRows[0];
      if (!control) throw new Error("Controle de beta não encontrado.");

      const activeWaveId = control.active_wave_id
        ? String(control.active_wave_id)
        : undefined;
      if (input.waveId && activeWaveId && input.waveId !== activeWaveId) {
        throw new Error(
          "A observação automática deve apontar para a onda ativa."
        );
      }
      const waveId = activeWaveId ?? input.waveId;
      const waveRows = waveId
        ? await tx`
            SELECT thresholds,status
            FROM beta_rollout_waves
            WHERE id=${waveId}::uuid
            FOR UPDATE
          `
        : [];
      const wave = waveRows[0];
      if (waveId && !wave) throw new Error("Onda de beta não encontrada.");

      await tx`
        INSERT INTO beta_rollout_observations (
          id,wave_id,error_rate_percent,p95_latency_ms,critical_reports,
          active_users,metadata,recorded_by
        ) VALUES (
          ${randomUUID()}::uuid,
          ${waveId ?? null}::uuid,
          ${input.errorRatePercent},
          ${input.p95LatencyMs},
          ${input.criticalReports},
          ${input.activeUsers},
          ${JSON.stringify(input.metadata ?? {})}::jsonb,
          ${input.actorId}::uuid
        )
      `;

      const effectiveThresholds = thresholds(
        wave?.thresholds,
        thresholds(control.thresholds)
      );
      const result = evaluateRolloutObservation({
        errorRatePercent: input.errorRatePercent,
        p95LatencyMs: input.p95LatencyMs,
        criticalReports: input.criticalReports,
        thresholds: effectiveThresholds
      });

      const active = activeWaveId
        && waveId === activeWaveId
        && String(wave?.status) === "active";
      if (active && result.decision === "rollback") {
        await this.rollbackTx(
          tx,
          activeWaveId,
          input.actorId,
          result.reasons.join(" ")
        );
      } else if (active && result.decision === "pause") {
        await this.pauseTx(
          tx,
          activeWaveId,
          input.actorId,
          result.reasons.join(" "),
          true
        );
      }
      return result;
    });
  }

  async setKillSwitch(input: {
    actorId: string;
    enabled: boolean;
    reason: string;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT control.active_wave_id,control.status,wave.status wave_status
        FROM beta_rollout_control control
        LEFT JOIN beta_rollout_waves wave
          ON wave.id=control.active_wave_id
        WHERE control.control_key='public-beta'
        FOR UPDATE OF control
      `;
      const control = rows[0];
      if (!control) throw new Error("Controle de beta não encontrado.");

      if (input.enabled
        && control.active_wave_id
        && String(control.wave_status) === "active") {
        await this.pauseTx(
          tx,
          String(control.active_wave_id),
          input.actorId,
          input.reason,
          true
        );
        return;
      }

      await tx`
        UPDATE beta_rollout_control SET
          kill_switch=${input.enabled},
          status=${input.enabled ? "paused" : String(control.status)},
          reason=${input.reason.slice(0,1000)},
          updated_by=${input.actorId}::uuid,
          updated_at=now()
        WHERE control_key='public-beta'
      `;
    });
  }

  async readiness(): Promise<ControlledBetaReadiness> {
    const mode = rolloutMode();
    const [controls, waves] = await Promise.all([
      this.sql`
        SELECT mode,status,kill_switch
        FROM beta_rollout_control
        WHERE control_key='public-beta'
      `,
      this.sql`
        SELECT
          count(*) FILTER (
            WHERE wave.status='planned'
              AND wave.approved_at IS NOT NULL
              AND member.members>0
          )::int planned,
          count(*) FILTER (WHERE wave.status='active')::int active
        FROM beta_rollout_waves wave
        CROSS JOIN LATERAL (
          SELECT count(*)::int members
          FROM beta_wave_members
          WHERE wave_id=wave.id
        ) member
      `
    ]);
    const control = controls[0] ?? {};
    const wave = waves[0] ?? {};
    return evaluateControlledBetaReadiness({
      mode,
      status: String(control.status ?? "paused"),
      killSwitch: Boolean(control.kill_switch),
      plannedWaves: Number(wave.planned ?? 0),
      activeWaves: Number(wave.active ?? 0)
    });
  }

  async myAccess(userId: string): Promise<Readonly<{
    rolloutMode: string;
    activationState: string;
    wave: Readonly<{
      waveKey: string;
      label: string;
      status: string;
    }> | null;
  }>> {
    const rows = await this.sql`
      SELECT account.beta_activation_state,wave.wave_key,wave.label,wave.status
      FROM users account
      LEFT JOIN beta_wave_members member
        ON member.user_id=account.id
        AND member.status IN ('pending','active','paused')
      LEFT JOIN beta_rollout_waves wave ON wave.id=member.wave_id
      WHERE account.id=${userId}::uuid
      ORDER BY member.enrolled_at DESC NULLS LAST
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new Error("Conta não encontrada.");
    return {
      rolloutMode: rolloutMode(),
      activationState: String(row.beta_activation_state),
      wave: row.wave_key
        ? {
            waveKey: String(row.wave_key),
            label: String(row.label),
            status: String(row.status)
          }
        : null
    };
  }

  async state(): Promise<Readonly<{
    readiness: ControlledBetaReadiness;
    control: BetaControlView;
    waves: readonly BetaWaveView[];
    observations: readonly Readonly<{
      id: string;
      waveId: string | null;
      errorRatePercent: number;
      p95LatencyMs: number;
      criticalReports: number;
      activeUsers: number;
      recordedAt: string;
    }>[];
  }>> {
    const [readiness, controls, waves, observations] = await Promise.all([
      this.readiness(),
      this.sql`
        SELECT * FROM beta_rollout_control
        WHERE control_key='public-beta'
      `,
      this.sql`
        SELECT wave.*,count(member.user_id)::int members,
          count(member.user_id) FILTER (
            WHERE member.status='active'
          )::int active_members
        FROM beta_rollout_waves wave
        LEFT JOIN beta_wave_members member ON member.wave_id=wave.id
        GROUP BY wave.id
        ORDER BY wave.created_at DESC
        LIMIT 100
      `,
      this.sql`
        SELECT * FROM beta_rollout_observations
        ORDER BY recorded_at DESC
        LIMIT 200
      `
    ]);
    const control = controls[0];
    if (!control) throw new Error("Controle de beta não encontrado.");

    return {
      readiness,
      control: {
        mode: String(control.mode),
        status: String(control.status),
        killSwitch: Boolean(control.kill_switch),
        activeWaveId: control.active_wave_id
          ? String(control.active_wave_id)
          : null,
        thresholds: control.thresholds,
        reason: control.reason ? String(control.reason) : null,
        updatedAt: new Date(String(control.updated_at)).toISOString()
      },
      waves: waves.map((row) => this.mapWave(
        row,
        Number(row.members ?? 0),
        Number(row.active_members ?? 0)
      )),
      observations: observations.map((row) => ({
        id: String(row.id),
        waveId: row.wave_id ? String(row.wave_id) : null,
        errorRatePercent: Number(row.error_rate_percent),
        p95LatencyMs: Number(row.p95_latency_ms),
        criticalReports: Number(row.critical_reports),
        activeUsers: Number(row.active_users),
        recordedAt: new Date(String(row.recorded_at)).toISOString()
      }))
    };
  }

  private async assertStartConditions(
    tx: Tx,
    waveId: string
  ): Promise<void> {
    const windowStart = new Date();
    const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);
    const [gates, components, control, shifts, overdue, waves, activeWaves] =
      await Promise.all([
        tx`
          SELECT count(*)::int total FROM release_gate_checks
          WHERE gate_key NOT IN (
            'controlled-beta-wave-prepared',
            'moderation-sla-coverage'
          )
            AND status NOT IN ('passing','waived')
        `,
        tx`
          SELECT count(*)::int total FROM public_service_components
          WHERE status<>'operational'
        `,
        tx`
          SELECT kill_switch FROM beta_rollout_control
          WHERE control_key='public-beta'
          FOR UPDATE
        `,
        tx`
          SELECT shift.moderator_id,shift.starts_at,shift.ends_at
          FROM moderation_shifts shift
          JOIN users account
            ON account.id=shift.moderator_id
            AND account.status='active'
          JOIN user_roles role
            ON role.user_id=account.id
            AND role.role IN ('platform-admin','municipal-admin')
          WHERE shift.status IN ('scheduled','active')
            AND shift.starts_at<${windowEnd.toISOString()}
            AND shift.ends_at>${windowStart.toISOString()}
          ORDER BY shift.starts_at
        `,
        tx`
          SELECT count(*)::int total FROM trust_reports
          WHERE priority IN ('critical','high')
            AND status IN ('open','triaged','investigating')
            AND first_response_due_at<now()
            AND acknowledged_at IS NULL
        `,
        tx`
          SELECT created_by,approved_by,approved_at,
            starts_at,ends_at,status
          FROM beta_rollout_waves
          WHERE id=${waveId}::uuid
          FOR UPDATE
        `,
        tx`
          SELECT count(*)::int total
          FROM beta_rollout_waves
          WHERE status='active' AND id<>${waveId}::uuid
        `
      ]);

    const memberRows = await tx`
      SELECT count(*)::int members
      FROM beta_wave_members
      WHERE wave_id=${waveId}::uuid
    `;

    if (Number(gates[0]?.total ?? 0) > 0) {
      throw new Error("Existem gates de release pendentes ou bloqueados.");
    }
    if (Number(components[0]?.total ?? 0) > 0) {
      throw new Error(
        "Todos os componentes públicos devem estar operacionais."
      );
    }
    if (Boolean(control[0]?.kill_switch)) {
      throw new Error(
        "Desarme o kill switch explicitamente antes de iniciar a onda."
      );
    }
    if (Number(overdue[0]?.total ?? 0) > 0) {
      throw new Error("Existem denúncias críticas ou altas fora do SLA.");
    }
    if (Number(activeWaves[0]?.total ?? 0) > 0) {
      throw new Error("Já existe outra onda ativa.");
    }

    const coveredMinutes = calculateContinuousCoverageMinutes(
      shifts.map((row) => ({
        startsAt: new Date(String(row.starts_at)).toISOString(),
        endsAt: new Date(String(row.ends_at)).toISOString()
      })),
      windowStart,
      windowEnd
    );
    if (coveredMinutes < 24 * 60) {
      throw new Error(
        `A cobertura contínua de moderação é ${coveredMinutes}/1440 minutos.`
      );
    }

    const wave = waves[0];
    if (!wave || !["planned", "paused"].includes(String(wave.status))) {
      throw new Error("Onda não encontrada ou indisponível para início.");
    }
    if (!wave.approved_at || !wave.approved_by) {
      throw new Error("A onda ainda não recebeu aprovação independente.");
    }
    if (String(wave.approved_by) === String(wave.created_by)) {
      throw new Error("Criador e aprovador da onda devem ser pessoas distintas.");
    }
    if (Number(memberRows[0]?.members ?? 0) < 1) {
      throw new Error("A onda não possui membros elegíveis.");
    }
    if (wave.starts_at
      && new Date(String(wave.starts_at)).getTime() > Date.now()) {
      throw new Error("A janela programada da onda ainda não começou.");
    }
    if (wave.ends_at
      && new Date(String(wave.ends_at)).getTime() <= Date.now()) {
      throw new Error("A janela programada da onda já terminou.");
    }
  }

  private async eligiblePopulation(
    tx: Tx,
    policy: WaveEligibility
  ): Promise<number> {
    const rows = await tx`
      SELECT count(*)::int total
      FROM users account
      WHERE account.status='active'
        AND account.email_verified_at IS NOT NULL
        AND account.public_beta_access='active'
        AND account.created_at<=now()-make_interval(days=>${policy.minimumAccountAgeDays})
        ${policy.requireMfa ? tx`AND account.mfa_enabled=true` : tx``}
        ${policy.trustReady ? this.trustEligibilityFragment(tx) : tx``}
    `;
    return Number(rows[0]?.total ?? 0);
  }

  private async eligibleCandidates(
    tx: Tx,
    userIds: readonly string[],
    policy: WaveEligibility,
    limit: number
  ) {
    return tx`
      SELECT account.id,account.beta_activation_state
      FROM users account
      WHERE account.id=ANY(${userIds}::uuid[])
        AND account.status='active'
        AND account.email_verified_at IS NOT NULL
        AND account.public_beta_access='active'
        AND account.created_at<=now()-make_interval(days=>${policy.minimumAccountAgeDays})
        ${policy.requireMfa ? tx`AND account.mfa_enabled=true` : tx``}
        ${policy.trustReady ? this.trustEligibilityFragment(tx) : tx``}
      ORDER BY account.id
      LIMIT ${limit}
      FOR UPDATE OF account
    `;
  }

  private trustEligibilityFragment(tx: Tx) {
    return tx`
      AND EXISTS (
        SELECT 1 FROM trust_age_assurance age
        WHERE age.user_id=account.id
          AND (
            (age.age_band='18-plus' AND age.guardian_status='not-required')
            OR (
              age.age_band IN ('14-15','16-17')
              AND age.guardian_status='approved'
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (
          SELECT DISTINCT ON (document_key) id
          FROM trust_legal_documents
          WHERE required_for_beta=true
            AND status='published'
            AND effective_at<=now()
          ORDER BY document_key,effective_at DESC,updated_at DESC
        ) current_document
        WHERE NOT EXISTS (
          SELECT 1 FROM trust_document_acceptances acceptance
          WHERE acceptance.user_id=account.id
            AND acceptance.document_id=current_document.id
            AND acceptance.withdrawn_at IS NULL
        )
      )
    `;
  }

  private async syncGateTx(tx: Tx, actorId: string): Promise<void> {
    const rows = await tx`
      SELECT count(*)::int total
      FROM beta_rollout_waves wave
      WHERE wave.status='active'
        OR (
          wave.status='planned'
          AND wave.approved_at IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM beta_wave_members member
            WHERE member.wave_id=wave.id
          )
        )
    `;
    const prepared = Number(rows[0]?.total ?? 0);
    await tx`
      UPDATE release_gate_checks SET
        status=${prepared > 0 ? "passing" : "pending"},
        evidence=${JSON.stringify({ preparedWaves: prepared })}::jsonb,
        checked_at=now(),
        updated_by=${actorId}::uuid,
        updated_at=now()
      WHERE gate_key='controlled-beta-wave-prepared'
    `;
  }

  private async pauseTx(
    tx: Tx,
    waveId: string,
    actorId: string,
    reason: string,
    killSwitch: boolean
  ): Promise<void> {
    const rows = await tx`
      UPDATE beta_rollout_waves SET
        status='paused',
        updated_by=${actorId}::uuid,
        updated_at=now()
      WHERE id=${waveId}::uuid
        AND status='active'
      RETURNING id
    `;
    if (!rows[0]) throw new Error("Onda ativa não encontrada.");

    await tx`
      UPDATE beta_wave_members SET status='paused',paused_at=now()
      WHERE wave_id=${waveId}::uuid AND status='active'
    `;
    await tx`
      UPDATE users account SET
        beta_activation_state='paused',
        beta_activation_updated_at=now(),
        updated_at=now()
      FROM beta_wave_members member
      WHERE member.wave_id=${waveId}::uuid
        AND member.user_id=account.id
        AND member.status='paused'
    `;
    await tx`
      UPDATE beta_rollout_control SET
        status='paused',
        kill_switch=${killSwitch},
        active_wave_id=${waveId}::uuid,
        reason=${reason.slice(0,1000)},
        updated_by=${actorId}::uuid,
        updated_at=now()
      WHERE control_key='public-beta'
    `;
    await this.event(
      tx,
      waveId,
      "wave-paused",
      "active",
      "paused",
      reason,
      { killSwitch },
      actorId
    );
  }

  private async rollbackTx(
    tx: Tx,
    waveId: string,
    actorId: string,
    reason: string
  ): Promise<void> {
    const rows = await tx`
      UPDATE beta_rollout_waves SET
        status='rolled-back',
        rollback_reason=${reason.slice(0,4000)},
        completed_at=now(),
        updated_by=${actorId}::uuid,
        updated_at=now()
      WHERE id=${waveId}::uuid
        AND status IN ('active','paused')
      RETURNING id
    `;
    if (!rows[0]) throw new Error("Onda não encontrada para rollback.");

    await tx`
      UPDATE users account SET
        beta_activation_state=COALESCE(
          member.previous_activation_state,
          'pending'
        ),
        beta_activation_updated_at=now(),
        updated_at=now()
      FROM beta_wave_members member
      WHERE member.wave_id=${waveId}::uuid
        AND member.user_id=account.id
        AND member.status IN ('active','paused','pending')
    `;
    await tx`
      UPDATE beta_wave_members SET status='revoked',revoked_at=now()
      WHERE wave_id=${waveId}::uuid
        AND status IN ('active','paused','pending')
    `;
    await tx`
      UPDATE beta_rollout_control SET
        status='rollback',
        kill_switch=true,
        active_wave_id=NULL,
        reason=${reason.slice(0,1000)},
        updated_by=${actorId}::uuid,
        updated_at=now()
      WHERE control_key='public-beta'
    `;
    await this.event(
      tx,
      waveId,
      "wave-rollback",
      null,
      "rolled-back",
      reason,
      {},
      actorId
    );
    await this.syncGateTx(tx, actorId);
  }

  private async event(
    tx: Tx,
    waveId: string | null,
    eventType: string,
    previousStatus: string | null,
    status: string,
    reason: string,
    evidence: unknown,
    actorId: string
  ): Promise<void> {
    await tx`
      INSERT INTO beta_rollout_events (
        id,wave_id,event_type,previous_status,status,reason,evidence,created_by
      ) VALUES (
        ${randomUUID()}::uuid,
        ${waveId}::uuid,
        ${eventType},
        ${previousStatus},
        ${status},
        ${reason.slice(0,4000)},
        ${JSON.stringify(evidence)}::jsonb,
        ${actorId}::uuid
      )
    `;
  }

  private mapWave(
    row: Record<string, unknown> | undefined,
    members: number,
    activeMembers: number
  ): BetaWaveView {
    if (!row) throw new Error("Onda de beta não pôde ser criada.");
    return {
      id: String(row.id),
      waveKey: String(row.wave_key),
      label: String(row.label),
      status: String(row.status),
      targetPercent: Number(row.target_percent),
      maxActivations: Number(row.max_activations),
      eligibility: row.eligibility,
      thresholds: row.thresholds,
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      activatedAt: iso(row.activated_at),
      completedAt: iso(row.completed_at),
      rollbackReason: row.rollback_reason
        ? String(row.rollback_reason)
        : null,
      approvedBy: row.approved_by ? String(row.approved_by) : null,
      approvedAt: iso(row.approved_at),
      members,
      activeMembers
    };
  }
}
