import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import {
  evaluateLaunchOperationsReadiness,
  type LaunchOperationsReadiness
} from "./launch-assurance-rules.js";

export type ResponseExerciseView = Readonly<{
  id: string; exerciseKey: string; scenario: string; status: string;
  scheduledAt: string; startedAt: string | null; completedAt: string | null;
  objectives: unknown; findings: unknown; evidence: unknown;
}>;
export type ServiceComponentView = Readonly<{
  key: string; label: string; status: string; description: string | null;
  publicMessage: string | null; updatedAt: string;
}>;
export type LaunchRehearsalView = Readonly<{
  id: string; rehearsalKey: string; rehearsalType: string; environment: string;
  commitSha: string | null; status: string; checklist: unknown; evidence: unknown;
  notes: string | null; startedAt: string | null; completedAt: string | null;
}>;

function iso(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}

export class LaunchOperationsService extends EconomyRepositoryBase {
  async createExercise(input: {
    actorId: string; scenario: string; scheduledAt: string; objectives: unknown;
    idempotencyKey: string;
  }): Promise<ResponseExerciseView> {
    return this.idempotent(`exercise:${input.idempotencyKey}`, input.actorId, input, async (tx) => {
      const id = randomUUID();
      const key = `EX-${new Date(input.scheduledAt).getUTCFullYear()}-${id.slice(0,8).toUpperCase()}`;
      const rows = await tx`
        INSERT INTO trust_response_exercises (
          id,exercise_key,scenario,scheduled_at,objectives,owner_id,created_by
        ) VALUES (${id}::uuid,${key},${input.scenario},${input.scheduledAt},
          ${JSON.stringify(input.objectives)}::jsonb,${input.actorId}::uuid,${input.actorId}::uuid)
        RETURNING *
      `;
      return this.mapExercise(rows[0]);
    });
  }

  async completeExercise(input: {
    actorId: string; exerciseId: string; status: "passed" | "failed";
    findings: unknown; evidence: unknown;
    actions: readonly Readonly<{ title: string; ownerId?: string; dueAt?: string }>[];
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE trust_response_exercises SET status=${input.status},
          started_at=COALESCE(started_at,now()),completed_at=now(),
          findings=${JSON.stringify(input.findings)}::jsonb,
          evidence=${JSON.stringify(input.evidence)}::jsonb,updated_at=now()
        WHERE id=${input.exerciseId}::uuid AND status IN ('planned','running') RETURNING id
      `;
      if (!rows[0]) throw new Error("Exercício não encontrado ou já concluído.");
      for (const action of input.actions) {
        await tx`
          INSERT INTO trust_exercise_actions (id,exercise_id,title,owner_id,due_at)
          VALUES (${randomUUID()}::uuid,${input.exerciseId}::uuid,${action.title},
            ${action.ownerId ?? null}::uuid,${action.dueAt ?? null})
        `;
      }
      await this.syncGate(tx, "incident-exercise-current", input.status === "passed", {
        exerciseId: input.exerciseId, completedAt: new Date().toISOString()
      }, input.actorId);
    });
  }

  async createRehearsal(input: {
    actorId: string;
    rehearsalType: "public-beta-open" | "rollback" | "provider-delivery" | "backup-restore";
    environment: string; commitSha?: string | undefined; checklist: unknown;
    idempotencyKey: string;
  }): Promise<LaunchRehearsalView> {
    return this.idempotent(`rehearsal:${input.idempotencyKey}`, input.actorId, input, async (tx) => {
      const id = randomUUID();
      const key = `REH-${input.rehearsalType.toUpperCase()}-${id.slice(0,8).toUpperCase()}`;
      const rows = await tx`
        INSERT INTO launch_rehearsals (
          id,rehearsal_key,rehearsal_type,environment,commit_sha,checklist,owner_id,created_by
        ) VALUES (${id}::uuid,${key},${input.rehearsalType},${input.environment},
          ${input.commitSha ?? null},${JSON.stringify(input.checklist)}::jsonb,
          ${input.actorId}::uuid,${input.actorId}::uuid) RETURNING *
      `;
      return this.mapRehearsal(rows[0]);
    });
  }

  async completeRehearsal(input: {
    actorId: string; rehearsalId: string; status: "passed" | "failed";
    evidence: unknown; notes?: string | undefined;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE launch_rehearsals SET status=${input.status},
          started_at=COALESCE(started_at,now()),completed_at=now(),
          evidence=${JSON.stringify(input.evidence)}::jsonb,
          notes=${input.notes?.slice(0,4000) ?? null},updated_at=now()
        WHERE id=${input.rehearsalId}::uuid AND status IN ('planned','running')
        RETURNING rehearsal_type
      `;
      const row = rows[0];
      if (!row) throw new Error("Ensaio não encontrado ou já concluído.");
      const type = String(row.rehearsal_type);
      const gate = type === "public-beta-open" ? "launch-rehearsal-current"
        : type === "rollback" ? "rollback-rehearsal-current" : null;
      if (gate) await this.syncGate(tx, gate, input.status === "passed", {
        rehearsalId: input.rehearsalId, type, completedAt: new Date().toISOString()
      }, input.actorId);
    });
  }

  async updateComponent(input: {
    actorId: string; componentKey: string;
    status: "operational" | "degraded" | "partial-outage" | "major-outage" | "maintenance";
    message?: string | undefined;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const old = await tx`
        SELECT status FROM public_service_components WHERE component_key=${input.componentKey} FOR UPDATE
      `;
      if (!old[0]) throw new Error("Componente não encontrado.");
      await tx`
        UPDATE public_service_components SET status=${input.status},
          public_message=${input.message?.slice(0,1000) ?? null},
          updated_by=${input.actorId}::uuid,updated_at=now()
        WHERE component_key=${input.componentKey}
      `;
      await tx`
        INSERT INTO public_service_component_updates (
          id,component_key,previous_status,status,message,created_by
        ) VALUES (${randomUUID()}::uuid,${input.componentKey},${String(old[0].status)},
          ${input.status},${input.message?.slice(0,1000) ?? null},${input.actorId}::uuid)
      `;
    });
  }

  async readiness(): Promise<LaunchOperationsReadiness> {
    const [components, exercise, rehearsals, reports] = await Promise.all([
      this.sql`SELECT component_key,status FROM public_service_components`,
      this.sql`SELECT completed_at FROM trust_response_exercises WHERE status='passed' ORDER BY completed_at DESC LIMIT 1`,
      this.sql`
        SELECT DISTINCT ON (rehearsal_type) rehearsal_type,completed_at
        FROM launch_rehearsals WHERE status='passed'
        ORDER BY rehearsal_type,completed_at DESC
      `,
      this.sql`
        SELECT count(*)::int total FROM trust_reports
        WHERE priority='critical' AND status IN ('open','triaged','investigating')
      `
    ]);
    return evaluateLaunchOperationsReadiness({
      componentStatuses: Object.fromEntries(
        components.map((row) => [String(row.component_key), String(row.status)])
      ),
      latestPassedIncidentExerciseAt: iso(exercise[0]?.completed_at),
      latestPassedRehearsals: Object.fromEntries(
        rehearsals.map((row) => [String(row.rehearsal_type), iso(row.completed_at)])
      ),
      openCriticalReports: Number(reports[0]?.total ?? 0)
    });
  }

  async publicStatus(): Promise<Readonly<{
    overall: string; components: readonly ServiceComponentView[];
    incidents: readonly Readonly<{
      incidentKey: string; severity: string; status: string; title: string;
      summary: string; detectedAt: string; updatedAt: string;
    }>[];
    updatedAt: string; signature: "Tehkné Solutions";
  }>> {
    const [components, incidents] = await Promise.all([
      this.sql`SELECT * FROM public_service_components ORDER BY component_key`,
      this.sql`
        SELECT incident_key,severity,status,title,summary,detected_at,updated_at
        FROM trust_incidents WHERE public_visible=true ORDER BY detected_at DESC LIMIT 50
      `
    ]);
    const mapped = components.map((row) => this.mapComponent(row));
    const rank: Record<string, number> = {
      operational: 0, maintenance: 1, degraded: 2, "partial-outage": 3, "major-outage": 4
    };
    const overall = mapped.reduce(
      (current, component) => (rank[component.status] ?? 4) > (rank[current] ?? 4)
        ? component.status : current,
      "operational"
    );
    return {
      overall, components: mapped,
      incidents: incidents.map((row) => ({
        incidentKey: String(row.incident_key), severity: String(row.severity),
        status: String(row.status), title: String(row.title), summary: String(row.summary),
        detectedAt: new Date(String(row.detected_at)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString()
      })),
      updatedAt: new Date().toISOString(), signature: "Tehkné Solutions"
    };
  }

  async state(): Promise<Readonly<{
    readiness: LaunchOperationsReadiness;
    exercises: readonly ResponseExerciseView[];
    rehearsals: readonly LaunchRehearsalView[];
    components: readonly ServiceComponentView[];
  }>> {
    const [readiness, exercises, rehearsals, components] = await Promise.all([
      this.readiness(),
      this.sql`SELECT * FROM trust_response_exercises ORDER BY scheduled_at DESC LIMIT 100`,
      this.sql`SELECT * FROM launch_rehearsals ORDER BY created_at DESC LIMIT 100`,
      this.sql`SELECT * FROM public_service_components ORDER BY component_key`
    ]);
    return {
      readiness,
      exercises: exercises.map((row) => this.mapExercise(row)),
      rehearsals: rehearsals.map((row) => this.mapRehearsal(row)),
      components: components.map((row) => this.mapComponent(row))
    };
  }

  private async syncGate(tx: Tx, key: string, passing: boolean, evidence: unknown, actorId: string) {
    await tx`
      UPDATE release_gate_checks SET status=${passing ? "passing" : "blocked"},
        evidence=${JSON.stringify(evidence)}::jsonb,checked_at=now(),
        updated_by=${actorId}::uuid,updated_at=now() WHERE gate_key=${key}
    `;
  }
  private mapExercise(row: Record<string, unknown> | undefined): ResponseExerciseView {
    if (!row) throw new Error("Exercício não pôde ser criado.");
    return {
      id: String(row.id), exerciseKey: String(row.exercise_key), scenario: String(row.scenario),
      status: String(row.status), scheduledAt: new Date(String(row.scheduled_at)).toISOString(),
      startedAt: iso(row.started_at), completedAt: iso(row.completed_at),
      objectives: row.objectives, findings: row.findings, evidence: row.evidence
    };
  }
  private mapComponent(row: Record<string, unknown>): ServiceComponentView {
    return {
      key: String(row.component_key), label: String(row.label), status: String(row.status),
      description: row.description ? String(row.description) : null,
      publicMessage: row.public_message ? String(row.public_message) : null,
      updatedAt: new Date(String(row.updated_at)).toISOString()
    };
  }
  private mapRehearsal(row: Record<string, unknown> | undefined): LaunchRehearsalView {
    if (!row) throw new Error("Ensaio não pôde ser criado.");
    return {
      id: String(row.id), rehearsalKey: String(row.rehearsal_key),
      rehearsalType: String(row.rehearsal_type), environment: String(row.environment),
      commitSha: row.commit_sha ? String(row.commit_sha) : null, status: String(row.status),
      checklist: row.checklist, evidence: row.evidence,
      notes: row.notes ? String(row.notes) : null,
      startedAt: iso(row.started_at), completedAt: iso(row.completed_at)
    };
  }
}
