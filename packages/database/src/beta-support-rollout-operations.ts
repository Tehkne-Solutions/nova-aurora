import { BetaSupportRolloutService as BaseBetaSupportRolloutService } from "./beta-support-rollouts.js";

export class BetaSupportRolloutService extends BaseBetaSupportRolloutService {
  override async activateFlag(input: {
    actorId: string;
    flagId: string;
  }): Promise<void> {
    await this.sql.begin("isolation level serializable",async (tx) => {
      const actors = await tx`
        SELECT account.id
        FROM users account
        WHERE account.id=${input.actorId}::uuid AND account.status='active'
          AND EXISTS (
            SELECT 1 FROM user_roles role
            WHERE role.user_id=account.id AND role.role='platform-admin'
          )
      `;
      if (!actors[0]) {
        throw new Error("A ativação exige um administrador de plataforma ativo.");
      }

      const flags = await tx`
        SELECT id,flag_key,status
        FROM beta_feature_flags
        WHERE id=${input.flagId}::uuid
        FOR UPDATE
      `;
      const flag = flags[0];
      if (!flag) throw new Error("Feature flag não encontrada.");

      const decisions = await tx`
        SELECT
          count(*) FILTER (WHERE decision='approve')::int approvals,
          count(*) FILTER (WHERE decision='reject')::int rejections
        FROM beta_feature_flag_approvals
        WHERE flag_id=${input.flagId}::uuid
      `;
      if (
        Number(decisions[0]?.approvals ?? 0) < 2
        || Number(decisions[0]?.rejections ?? 0) > 0
      ) {
        throw new Error("A flag exige duas aprovações e nenhuma rejeição.");
      }
      if (!["ready","paused"].includes(String(flag.status))) {
        throw new Error("A flag precisa estar pronta ou pausada para ativação.");
      }

      await tx`
        UPDATE beta_feature_flags SET
          status='active',activated_at=COALESCE(activated_at,now()),paused_at=NULL,
          updated_by=${input.actorId}::uuid,updated_at=now()
        WHERE id=${input.flagId}::uuid
      `;
      await this.outbox(tx,input.flagId,"beta.feature-flag.activated",{
        flagKey: flag.flag_key
      });
    });
    await this.syncGates(input.actorId);
  }
}
