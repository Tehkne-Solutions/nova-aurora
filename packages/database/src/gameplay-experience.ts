import { createHash, randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";

const HARVEST_ACTIONS = ["left", "right", "up", "down"] as const;
export type HarvestAction = typeof HARVEST_ACTIONS[number];

export type HarvestSessionView = Readonly<{
  id: string;
  challenge: readonly HarvestAction[];
  score: number;
  status: "active" | "completed" | "failed" | "expired";
  startedAt: string;
  expiresAt: string;
  completedAt: string | null;
}>;

export type NpcView = Readonly<{
  code: string;
  name: string;
  roleTitle: string;
  avatar: string;
  locationCode: string;
  dialogue: readonly string[];
}>;

function challengeFromSessionId(sessionId: string): readonly HarvestAction[] {
  const bytes = createHash("sha256").update(sessionId).digest();
  return Array.from({ length: 7 }, (_, index) =>
    HARVEST_ACTIONS[(bytes[index] ?? 0) % HARVEST_ACTIONS.length] ?? "up"
  );
}

export class GameplayExperienceService extends EconomyRepositoryBase {
  async experienceState(ownerId: string): Promise<Readonly<{
    avatarCode: string;
    facing: string;
    npcs: readonly NpcView[];
    activeHarvest: HarvestSessionView | null;
  }>> {
    const [avatarRows, npcRows, sessionRows] = await Promise.all([
      this.sql`
        SELECT avatar_code,facing FROM player_avatar_state
        WHERE user_id=${ownerId}::uuid
      `,
      this.sql`
        SELECT npc.code,npc.name,npc.role_title,npc.avatar,npc.dialogue,
               location.code location_code
        FROM game_npcs npc
        JOIN city_locations location ON location.id=npc.location_id
        JOIN player_world_state state
          ON state.user_id=${ownerId}::uuid AND state.location_id=npc.location_id
        ORDER BY npc.name
      `,
      this.sql`
        SELECT * FROM harvest_sessions
        WHERE user_id=${ownerId}::uuid AND status='active'
        ORDER BY started_at DESC LIMIT 1
      `
    ]);

    return {
      avatarCode: String(avatarRows[0]?.avatar_code ?? "founder-01"),
      facing: String(avatarRows[0]?.facing ?? "south"),
      npcs: npcRows.map((row) => ({
        code: String(row.code),
        name: String(row.name),
        roleTitle: String(row.role_title),
        avatar: String(row.avatar),
        locationCode: String(row.location_code),
        dialogue: Array.isArray(row.dialogue)
          ? row.dialogue.map((line) => String(line))
          : []
      })),
      activeHarvest: sessionRows[0]
        ? this.mapHarvestSession(sessionRows[0])
        : null
    };
  }

  async startHarvest(input: {
    ownerId: string;
    idempotencyKey: string;
  }): Promise<HarvestSessionView> {
    return this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.assertLocation(tx, input.ownerId, "harvest-fields");

      const assignments = await tx`
        SELECT assignment.id
        FROM player_job_assignments assignment
        JOIN public_jobs job ON job.id=assignment.job_id
        WHERE assignment.user_id=${input.ownerId}::uuid
          AND job.code='harvest-support'
          AND assignment.status='accepted'
        FOR UPDATE OF assignment
      `;
      const assignment = assignments[0];
      if (!assignment) {
        throw new Error("Aceite Apoio à Colheita antes de iniciar o minijogo.");
      }

      const activeRows = await tx`
        SELECT * FROM harvest_sessions
        WHERE user_id=${input.ownerId}::uuid AND status='active'
        ORDER BY started_at DESC LIMIT 1 FOR UPDATE
      `;
      if (activeRows[0]) {
        return this.mapHarvestSession(activeRows[0]);
      }

      const sessionId = randomUUID();
      const challenge = challengeFromSessionId(sessionId);
      await tx`
        INSERT INTO harvest_sessions (
          id,user_id,job_assignment_id,challenge,status,idempotency_key,expires_at
        ) VALUES (
          ${sessionId}::uuid,${input.ownerId}::uuid,${String(assignment.id)}::uuid,
          ${JSON.stringify(challenge)}::jsonb,'active',${input.idempotencyKey},
          now()+interval '2 minutes'
        )
      `;
      await this.outbox(tx, sessionId, "gameplay.harvest.started", {
        sessionId,
        ownerId: input.ownerId,
        challengeLength: challenge.length
      });
      return this.harvestSession(tx, sessionId);
    });
  }

  async completeHarvest(input: {
    ownerId: string;
    sessionId: string;
    sequence: readonly HarvestAction[];
    idempotencyKey: string;
  }): Promise<HarvestSessionView> {
    if (input.sequence.length !== 7) {
      throw new Error("A sequência de colheita precisa ter sete movimentos.");
    }
    if (input.sequence.some((action) => !HARVEST_ACTIONS.includes(action))) {
      throw new Error("Movimento de colheita inválido.");
    }

    return this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const rows = await tx`
        SELECT * FROM harvest_sessions
        WHERE id=${input.sessionId}::uuid
        FOR UPDATE
      `;
      const session = rows[0];
      if (!session || String(session.user_id) !== input.ownerId) {
        throw new Error("Sessão de colheita não encontrada.");
      }
      if (String(session.status) === "completed") {
        return this.mapHarvestSession(session);
      }
      if (String(session.status) !== "active") {
        throw new Error("A sessão de colheita não está ativa.");
      }
      if (new Date(String(session.expires_at)).getTime() <= Date.now()) {
        await tx`
          UPDATE harvest_sessions SET status='expired',completed_at=now()
          WHERE id=${input.sessionId}::uuid
        `;
        throw new Error("A sessão expirou. Inicie uma nova colheita.");
      }

      const challenge = Array.isArray(session.challenge)
        ? session.challenge.map((action) => String(action) as HarvestAction)
        : [];
      const correct = challenge.reduce(
        (total, action, index) => total + (input.sequence[index] === action ? 1 : 0),
        0
      );
      const elapsedMs = Math.max(
        0,
        Date.now() - new Date(String(session.started_at)).getTime()
      );
      const accuracyScore = Math.round(correct / challenge.length * 85);
      const speedBonus = Math.max(0, 15 - Math.floor(elapsedMs / 1_000));
      const score = Math.min(100, accuracyScore + speedBonus);
      const status = score >= 70 ? "completed" : "failed";

      await tx`
        UPDATE harvest_sessions
        SET score=${score},status=${status},completed_at=now()
        WHERE id=${input.sessionId}::uuid
      `;
      await this.outbox(tx, input.sessionId, `gameplay.harvest.${status}`, {
        sessionId: input.sessionId,
        ownerId: input.ownerId,
        correct,
        total: challenge.length,
        elapsedMs,
        score
      });
      return this.harvestSession(tx, input.sessionId);
    });
  }

  private async assertLocation(
    tx: Tx,
    ownerId: string,
    expectedLocationCode: string
  ): Promise<void> {
    const rows = await tx`
      SELECT location.code
      FROM player_world_state state
      JOIN city_locations location ON location.id=state.location_id
      WHERE state.user_id=${ownerId}::uuid
      FOR UPDATE OF state
    `;
    if (String(rows[0]?.code ?? "") !== expectedLocationCode) {
      throw new Error(`Viaje até ${expectedLocationCode} para continuar.`);
    }
  }

  private async harvestSession(
    tx: Tx,
    sessionId: string
  ): Promise<HarvestSessionView> {
    const rows = await tx`
      SELECT * FROM harvest_sessions WHERE id=${sessionId}::uuid
    `;
    if (!rows[0]) throw new Error("Sessão de colheita não encontrada.");
    return this.mapHarvestSession(rows[0]);
  }

  private mapHarvestSession(row: Record<string, unknown>): HarvestSessionView {
    return {
      id: String(row.id),
      challenge: Array.isArray(row.challenge)
        ? row.challenge.map((action) => String(action) as HarvestAction)
        : [],
      score: Number(row.score),
      status: row.status as HarvestSessionView["status"],
      startedAt: new Date(String(row.started_at)).toISOString(),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
      completedAt: row.completed_at
        ? new Date(String(row.completed_at)).toISOString()
        : null
    };
  }
}
