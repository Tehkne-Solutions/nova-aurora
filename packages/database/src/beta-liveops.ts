import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase,type Tx } from "./economy-base.js";

export type LiveOpsEventType =
  | "experiment-start" | "experiment-review" | "experiment-pause"
  | "experiment-complete" | "communication" | "maintenance" | "incident";
export type LiveOpsStatus = "scheduled" | "active" | "completed" | "cancelled";
export type LiveOpsSeverity = "info" | "success" | "warning" | "critical";

export type LiveOpsEventView = Readonly<{
  id:string; eventKey:string; experimentId:string|null; experimentKey:string|null;
  eventType:LiveOpsEventType; title:string; description:string; status:LiveOpsStatus;
  startsAt:string; endsAt:string|null; severity:LiveOpsSeverity;
  createdBy:string; updatedBy:string; createdAt:string; updatedAt:string;
}>;

export type ExperimentTimelineEntry = Readonly<{
  id:string; experimentId:string; kind:"experiment"|"approval"|"result"|"decision"|"liveops";
  event:string; status:string|null; actorId:string|null; occurredAt:string; details:unknown;
}>;

function iso(value:unknown):string { return new Date(String(value)).toISOString(); }
function optionalIso(value:unknown):string|null { return value ? iso(value) : null; }

export class BetaLiveOpsService extends EconomyRepositoryBase {
  async createEvent(input:{
    actorId:string; idempotencyKey:string; eventKey:string; experimentId?:string;
    eventType:LiveOpsEventType; title:string; description:string; status?:LiveOpsStatus;
    startsAt:string; endsAt?:string; severity:LiveOpsSeverity;
  }):Promise<LiveOpsEventView> {
    return this.idempotent(
      `beta-liveops:${input.actorId}:${input.idempotencyKey}`,input.actorId,input,
      async (tx) => {
        await this.assertPlatformAdmin(tx,input.actorId);
        if (input.experimentId) {
          const experiments=await tx`SELECT id FROM beta_experiments WHERE id=${input.experimentId}::uuid`;
          if (!experiments[0]) throw new Error("Experimento não encontrado.");
        }
        const id=randomUUID();
        const rows=await tx`
          INSERT INTO beta_liveops_events (
            id,event_key,experiment_id,event_type,title,description,status,
            starts_at,ends_at,severity,created_by,updated_by
          ) VALUES (
            ${id}::uuid,${input.eventKey},${input.experimentId ?? null}::uuid,
            ${input.eventType},${input.title.slice(0,180)},${input.description.slice(0,8000)},
            ${input.status ?? "scheduled"},${input.startsAt}::timestamptz,
            ${input.endsAt ?? null}::timestamptz,${input.severity},
            ${input.actorId}::uuid,${input.actorId}::uuid
          ) RETURNING *
        `;
        await this.outbox(tx,id,"beta.liveops.created",{
          eventKey:input.eventKey,eventType:input.eventType,severity:input.severity,
          experimentId:input.experimentId ?? null
        });
        return this.mapEvent(rows[0]);
      }
    );
  }

  async updateStatus(input:{
    actorId:string; eventId:string; status:LiveOpsStatus; reason:string;
  }):Promise<void> {
    await this.sql.begin("isolation level serializable",async (tx) => {
      await this.assertPlatformAdmin(tx,input.actorId);
      const rows=await tx`
        SELECT id,status,event_key,event_type FROM beta_liveops_events
        WHERE id=${input.eventId}::uuid FOR UPDATE
      `;
      const event=rows[0];
      if (!event) throw new Error("Evento LiveOps não encontrado.");
      const current=String(event.status) as LiveOpsStatus;
      const allowed:Record<LiveOpsStatus,readonly LiveOpsStatus[]>={
        scheduled:["active","cancelled"],active:["completed","cancelled"],
        completed:[],cancelled:[]
      };
      if (!allowed[current].includes(input.status)) {
        throw new Error(`Transição LiveOps inválida: ${current} → ${input.status}.`);
      }
      await tx`
        UPDATE beta_liveops_events SET status=${input.status},updated_by=${input.actorId}::uuid,
          updated_at=now() WHERE id=${input.eventId}::uuid
      `;
      await this.outbox(tx,input.eventId,"beta.liveops.status-updated",{
        eventKey:event.event_key,eventType:event.event_type,previousStatus:current,
        status:input.status,reason:input.reason.slice(0,2000)
      });
    });
  }

  async calendar(input:{from?:string;to?:string}={}):Promise<readonly LiveOpsEventView[]> {
    const rows=await this.sql`
      SELECT event.*,experiment.experiment_key
      FROM beta_liveops_events event
      LEFT JOIN beta_experiments experiment ON experiment.id=event.experiment_id
      WHERE (${input.from ?? null}::timestamptz IS NULL OR event.starts_at>=${input.from ?? null}::timestamptz)
        AND (${input.to ?? null}::timestamptz IS NULL OR event.starts_at<${input.to ?? null}::timestamptz)
      ORDER BY event.starts_at,event.created_at
      LIMIT 500
    `;
    return rows.map((row)=>this.mapEvent(row));
  }

  async experimentTimeline(experimentId:string):Promise<readonly ExperimentTimelineEntry[]> {
    const rows=await this.sql`
      SELECT * FROM (
        SELECT experiment.id::text id,experiment.id experiment_id,'experiment' kind,
          'created' event,experiment.status,NULL::uuid actor_id,experiment.created_at occurred_at,
          jsonb_build_object('experimentKey',experiment.experiment_key,'label',experiment.label) details
        FROM beta_experiments experiment WHERE experiment.id=${experimentId}::uuid
        UNION ALL
        SELECT concat(approval.experiment_id,'-',approval.actor_id),approval.experiment_id,'approval',
          approval.decision,approval.decision,approval.actor_id,approval.updated_at,
          jsonb_build_object('note',approval.note)
        FROM beta_experiment_approvals approval WHERE approval.experiment_id=${experimentId}::uuid
        UNION ALL
        SELECT result.id::text,result.experiment_id,'result','computed',result.recommendation,NULL::uuid,
          result.computed_at,jsonb_build_object('variant',result.variant,'periodStart',result.period_start,
            'periodEnd',result.period_end,'primaryMetricValue',result.primary_metric_value,
            'recommendation',result.recommendation,'evidence',result.evidence)
        FROM beta_experiment_results result WHERE result.experiment_id=${experimentId}::uuid
        UNION ALL
        SELECT decision.id::text,decision.experiment_id,'decision',decision.decision,decision.decision,
          decision.created_by,decision.created_at,
          jsonb_build_object('rationale',decision.rationale,'evidence',decision.evidence,
            'resultIds',decision.result_ids)
        FROM beta_experiment_decisions decision WHERE decision.experiment_id=${experimentId}::uuid
        UNION ALL
        SELECT event.id::text,event.experiment_id,'liveops',event.event_type,event.status,event.updated_by,
          event.updated_at,jsonb_build_object('eventKey',event.event_key,'title',event.title,
            'description',event.description,'severity',event.severity,'startsAt',event.starts_at,
            'endsAt',event.ends_at)
        FROM beta_liveops_events event WHERE event.experiment_id=${experimentId}::uuid
      ) timeline ORDER BY occurred_at,id
    `;
    return rows.map((row)=>({
      id:String(row.id),experimentId:String(row.experiment_id),
      kind:String(row.kind) as ExperimentTimelineEntry["kind"],event:String(row.event),
      status:row.status===null ? null : String(row.status),
      actorId:row.actor_id===null ? null : String(row.actor_id),
      occurredAt:iso(row.occurred_at),details:row.details
    }));
  }

  async adminState():Promise<Readonly<{
    calendar:readonly LiveOpsEventView[]; activeIncidents:number; upcoming:number;
  }>> {
    const [calendar,summary]=await Promise.all([
      this.calendar(),
      this.sql`
        SELECT count(*) FILTER (WHERE event_type='incident' AND status='active')::int active_incidents,
          count(*) FILTER (WHERE status='scheduled' AND starts_at>=now())::int upcoming
        FROM beta_liveops_events
      `
    ]);
    return {calendar,activeIncidents:Number(summary[0]?.active_incidents ?? 0),upcoming:Number(summary[0]?.upcoming ?? 0)};
  }

  private async assertPlatformAdmin(tx:Tx,actorId:string):Promise<void> {
    const rows=await tx`
      SELECT account.id FROM users account WHERE account.id=${actorId}::uuid AND account.status='active'
        AND EXISTS (SELECT 1 FROM user_roles role WHERE role.user_id=account.id AND role.role='platform-admin')
    `;
    if (!rows[0]) throw new Error("A operação exige administrador de plataforma ativo.");
  }

  private mapEvent(row:Record<string,unknown>):LiveOpsEventView {
    return {
      id:String(row.id),eventKey:String(row.event_key),
      experimentId:row.experiment_id ? String(row.experiment_id) : null,
      experimentKey:row.experiment_key ? String(row.experiment_key) : null,
      eventType:String(row.event_type) as LiveOpsEventType,title:String(row.title),
      description:String(row.description),status:String(row.status) as LiveOpsStatus,
      startsAt:iso(row.starts_at),endsAt:optionalIso(row.ends_at),
      severity:String(row.severity) as LiveOpsSeverity,createdBy:String(row.created_by),
      updatedBy:String(row.updated_by),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)
    };
  }
}
