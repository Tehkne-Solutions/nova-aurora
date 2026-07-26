import { BetaOperationsService } from "./beta-operations.js";
import type { ControlledBetaReadiness } from "./controlled-beta-rules.js";
import { BetaTelemetryService } from "./beta-telemetry.js";
import type { BetaCommunityReadiness } from "./beta-telemetry-rules.js";
import { LaunchAssuranceService } from "./launch-assurance.js";
import type { LaunchOperationsReadiness } from "./launch-assurance-rules.js";
import type { ModerationReadiness } from "./moderation-operations-rules.js";
import { ReleaseCandidateService } from "./release-candidate.js";
import type { TrustReadiness } from "./trust-readiness.js";

export type ReleaseReadinessSummary = Readonly<{
  registrationMode: "open" | "invite-only" | "closed";
  transactionalProviderConfigured: boolean;
  launchReady: boolean;
  users: Readonly<{
    total: number;
    activeBeta: number;
    pendingVerification: number;
    suspended: number;
    waveActive: number;
    wavePending: number;
  }>;
  email: Readonly<{ queued: number; failed: number; dead: number; sent: number }>;
  integrity: Readonly<{ openFraudEvents: number; restrictedUsers: number }>;
  gates: Readonly<{ passing: number; pending: number; blocked: number; waived: number }>;
  trust: TrustReadiness;
  operations: LaunchOperationsReadiness;
  moderation: ModerationReadiness;
  controlledBeta: ControlledBetaReadiness;
  community: BetaCommunityReadiness;
}>;

function registrationMode(): "open" | "invite-only" | "closed" {
  const configured = process.env.PUBLIC_REGISTRATION_MODE;
  if (configured === "open" || configured === "invite-only" || configured === "closed") {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "invite-only" : "open";
}

export class ReleaseOperationsService extends ReleaseCandidateService {
  private readonly assurance = new LaunchAssuranceService();
  private readonly beta = new BetaOperationsService();
  private readonly telemetry = new BetaTelemetryService();

  async summary(): Promise<ReleaseReadinessSummary> {
    const [users,emails,integrity,gates,trust,operations,moderation,controlledBeta,community] =
      await Promise.all([
        this.sql`
          SELECT count(*)::int total,
            count(*) FILTER (
              WHERE public_beta_access='active' AND status='active'
            )::int active_beta,
            count(*) FILTER (
              WHERE email_verification_required=true OR email_verified_at IS NULL
            )::int pending_verification,
            count(*) FILTER (
              WHERE public_beta_access='suspended' OR status<>'active'
            )::int suspended,
            count(*) FILTER (WHERE beta_activation_state='active')::int wave_active,
            count(*) FILTER (WHERE beta_activation_state='pending')::int wave_pending
          FROM users
        `,
        this.sql`
          SELECT count(*) FILTER (WHERE status='queued')::int queued,
            count(*) FILTER (WHERE status='failed')::int failed,
            count(*) FILTER (WHERE status='dead')::int dead,
            count(*) FILTER (WHERE status='sent')::int sent
          FROM transactional_email_outbox
        `,
        this.sql`
          SELECT
            (SELECT count(*)::int FROM fraud_events WHERE status='open') open_fraud_events,
            (SELECT count(*)::int FROM user_risk_profiles
              WHERE economic_status IN ('restricted','frozen')) restricted_users
        `,
        this.sql`
          SELECT count(*) FILTER (WHERE status='passing')::int passing,
            count(*) FILTER (WHERE status='pending')::int pending,
            count(*) FILTER (WHERE status='blocked')::int blocked,
            count(*) FILTER (WHERE status='waived')::int waived
          FROM release_gate_checks
        `,
        this.assurance.readiness(),
        this.assurance.operationsReadiness(),
        this.beta.moderationReadiness(),
        this.beta.controlledBetaReadiness(),
        this.telemetry.communityReadiness()
      ]);
    const user = users[0] ?? {};
    const email = emails[0] ?? {};
    const risk = integrity[0] ?? {};
    const gate = gates[0] ?? {};
    const providerConfigured = Boolean(
      process.env.TRANSACTIONAL_EMAIL_ENDPOINT?.trim()
      && process.env.TRANSACTIONAL_EMAIL_FROM?.trim()
    );
    const pending = Number(gate.pending ?? 0);
    const blocked = Number(gate.blocked ?? 0);
    const dead = Number(email.dead ?? 0);
    const openFraudEvents = Number(risk.open_fraud_events ?? 0);
    return {
      registrationMode: registrationMode(),
      transactionalProviderConfigured: providerConfigured,
      launchReady: providerConfigured
        && pending === 0
        && blocked === 0
        && dead === 0
        && openFraudEvents === 0
        && trust.launchReady
        && operations.launchReady
        && moderation.ready
        && controlledBeta.ready
        && community.ready,
      users: {
        total: Number(user.total ?? 0),
        activeBeta: Number(user.active_beta ?? 0),
        pendingVerification: Number(user.pending_verification ?? 0),
        suspended: Number(user.suspended ?? 0),
        waveActive: Number(user.wave_active ?? 0),
        wavePending: Number(user.wave_pending ?? 0)
      },
      email: {
        queued: Number(email.queued ?? 0),
        failed: Number(email.failed ?? 0),
        dead,
        sent: Number(email.sent ?? 0)
      },
      integrity: {
        openFraudEvents,
        restrictedUsers: Number(risk.restricted_users ?? 0)
      },
      gates: {
        passing: Number(gate.passing ?? 0),
        pending,
        blocked,
        waived: Number(gate.waived ?? 0)
      },
      trust,
      operations,
      moderation,
      controlledBeta,
      community
    };
  }
}
