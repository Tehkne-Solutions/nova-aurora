import { createHash,randomUUID } from "node:crypto";
import { EconomyRepositoryBase,type Tx } from "./economy-base.js";

export type DecisionAction="expand"|"hold"|"reduce"|"stop"|"reject";
export type DecisionQueueItem=Readonly<{
  experimentId:string;experimentKey:string;label:string;status:string;primaryMetric:string;
  recommendation:string|null;guardrailTriggered:boolean;expired:boolean;results:number;latestComputedAt:string|null;
}>;
export type ExperimentReportView=Readonly<{
  id:string;experimentId:string;reportKey:string;decisionId:string;summary:unknown;learning:string;
  futureRecommendations:readonly string[];auditHash:string;generatedBy:string;generatedAt:string;
}>;
function iso(value:unknown):string{return new Date(String(value)).toISOString();}
function strings(value:unknown):readonly string[]{return Array.isArray(value)?value.map(String):[];}

export class BetaDecisionCenterService extends EconomyRepositoryBase {
  async queue():Promise<readonly DecisionQueueItem[]> {
    const rows=await this.sql`
      SELECT experiment.id,experiment.experiment_key,experiment.label,experiment.status,
        experiment.primary_metric,experiment.ends_at,
        count(result.id)::int result_count,max(result.computed_at) latest_computed_at,
        (array_agg(result.recommendation ORDER BY result.computed_at DESC)
          FILTER (WHERE result.recommendation IS NOT NULL))[1] recommendation,
        coalesce(bool_or((result.evidence->>'guardrailTriggered')::boolean),false) guardrail_triggered
      FROM beta_experiments experiment
      LEFT JOIN beta_experiment_results result ON result.experiment_id=experiment.id
      WHERE experiment.status IN ('approved','running','paused')
        AND NOT EXISTS (SELECT 1 FROM beta_experiment_decisions decision WHERE decision.experiment_id=experiment.id)
      GROUP BY experiment.id
      ORDER BY guardrail_triggered DESC,experiment.ends_at NULLS LAST,experiment.created_at
    `;
    return rows.map((row)=>({
      experimentId:String(row.id),experimentKey:String(row.experiment_key),label:String(row.label),
      status:String(row.status),primaryMetric:String(row.primary_metric),
      recommendation:row.recommendation===null?null:String(row.recommendation),
      guardrailTriggered:Boolean(row.guardrail_triggered),
      expired:row.ends_at!==null && new Date(String(row.ends_at)).getTime()<Date.now(),
      results:Number(row.result_count),latestComputedAt:row.latest_computed_at?iso(row.latest_computed_at):null
    }));
  }

  async recordDecision(input:{actorId:string;experimentId:string;decision:DecisionAction;rationale:string;evidence:unknown;resultIds:readonly string[]}):Promise<string>{
    return this.sql.begin("isolation level serializable",async(tx)=>{
      await this.assertPlatformAdmin(tx,input.actorId);
      const experiments=await tx`SELECT id,status FROM beta_experiments WHERE id=${input.experimentId}::uuid FOR UPDATE`;
      if(!experiments[0]) throw new Error("Experimento não encontrado.");
      if(!["running","paused","approved"].includes(String(experiments[0].status))) throw new Error("Estado não aceita decisão.");
      const id=randomUUID();
      await tx`INSERT INTO beta_experiment_decisions(id,experiment_id,decision,rationale,evidence,result_ids,created_by)
        VALUES(${id}::uuid,${input.experimentId}::uuid,${input.decision},${input.rationale.slice(0,8000)},
        ${JSON.stringify(input.evidence??{})}::jsonb,${input.resultIds}::uuid[],${input.actorId}::uuid)`;
      await this.outbox(tx,input.experimentId,"beta.experiment.decision-recorded",{decision:input.decision,resultIds:input.resultIds});
      return id;
    });
  }

  async generateFinalReport(input:{actorId:string;experimentId:string;learning:string;futureRecommendations:readonly string[]}):Promise<ExperimentReportView>{
    return this.sql.begin("isolation level serializable",async(tx)=>{
      await this.assertPlatformAdmin(tx,input.actorId);
      const experiments=await tx`SELECT experiment.*,flag.flag_key FROM beta_experiments experiment JOIN beta_feature_flags flag ON flag.id=experiment.flag_id WHERE experiment.id=${input.experimentId}::uuid FOR UPDATE`;
      const experiment=experiments[0]; if(!experiment) throw new Error("Experimento não encontrado.");
      const decisions=await tx`SELECT * FROM beta_experiment_decisions WHERE experiment_id=${input.experimentId}::uuid ORDER BY created_at DESC LIMIT 1`;
      const decision=decisions[0]; if(!decision) throw new Error("Decisão humana obrigatória.");
      const results=await tx`SELECT * FROM beta_experiment_results WHERE experiment_id=${input.experimentId}::uuid ORDER BY period_end,variant`;
      const summary={experiment:{key:experiment.experiment_key,label:experiment.label,hypothesis:experiment.hypothesis,decisionQuestion:experiment.decision_question,flagKey:experiment.flag_key,primaryMetric:experiment.primary_metric,secondaryMetrics:experiment.secondary_metrics,guardrails:experiment.guardrails,startedAt:experiment.started_at,completedAt:experiment.completed_at},decision:{action:decision.decision,rationale:decision.rationale,evidence:decision.evidence,createdAt:decision.created_at},results};
      const canonical=JSON.stringify({experimentId:input.experimentId,decisionId:String(decision.id),summary,learning:input.learning,futureRecommendations:input.futureRecommendations});
      const auditHash=createHash("sha256").update(canonical).digest("hex");
      const id=randomUUID(); const reportKey=`experiment-${String(experiment.experiment_key)}-final`;
      const rows=await tx`INSERT INTO beta_experiment_reports(id,experiment_id,report_key,decision_id,summary,learning,future_recommendations,audit_hash,generated_by)
        VALUES(${id}::uuid,${input.experimentId}::uuid,${reportKey},${String(decision.id)}::uuid,${JSON.stringify(summary)}::jsonb,${input.learning.slice(0,12000)},${input.futureRecommendations}::text[],${auditHash},${input.actorId}::uuid)
        ON CONFLICT(experiment_id) DO UPDATE SET decision_id=excluded.decision_id,summary=excluded.summary,learning=excluded.learning,future_recommendations=excluded.future_recommendations,audit_hash=excluded.audit_hash,generated_by=excluded.generated_by,generated_at=now()
        RETURNING *`;
      const row=rows[0]; if(!row) throw new Error("Relatório não gerado.");
      await this.outbox(tx,input.experimentId,"beta.experiment.final-report-generated",{reportKey,auditHash});
      return this.mapReport(row);
    });
  }

  async reports():Promise<readonly ExperimentReportView[]>{const rows=await this.sql`SELECT * FROM beta_experiment_reports ORDER BY generated_at DESC LIMIT 200`;return rows.map((row)=>this.mapReport(row));}
  async adminState(){const[queue,reports]=await Promise.all([this.queue(),this.reports()]);return{queue,reports,pending:queue.length,guardrailAlerts:queue.filter((item)=>item.guardrailTriggered).length,expired:queue.filter((item)=>item.expired).length};}
  private mapReport(row:Record<string,unknown>):ExperimentReportView{return{id:String(row.id),experimentId:String(row.experiment_id),reportKey:String(row.report_key),decisionId:String(row.decision_id),summary:row.summary,learning:String(row.learning),futureRecommendations:strings(row.future_recommendations),auditHash:String(row.audit_hash),generatedBy:String(row.generated_by),generatedAt:iso(row.generated_at)};}
  private async assertPlatformAdmin(tx:Tx,actorId:string):Promise<void>{const rows=await tx`SELECT account.id FROM users account WHERE account.id=${actorId}::uuid AND account.status='active' AND EXISTS(SELECT 1 FROM user_roles role WHERE role.user_id=account.id AND role.role='platform-admin')`;if(!rows[0])throw new Error("A operação exige administrador de plataforma ativo.");}
}
