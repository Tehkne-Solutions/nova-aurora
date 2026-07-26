import { randomUUID } from "node:crypto";
import { dataEncryptionKey } from "./data-protection.js";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import {
  evaluateBetaCommunityReadiness,
  type BetaCommunityReadiness
} from "./beta-telemetry-rules.js";

export type BetaFeedbackView = Readonly<{
  id: string;
  feedbackKey: string;
  userId: string;
  userEmail: string;
  waveId: string | null;
  category: string;
  sentiment: string;
  score: number;
  summary: string;
  details: string;
  status: string;
  priority: string;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CommunityAnnouncementView = Readonly<{
  id: string;
  announcementKey: string;
  title: string;
  body: string;
  audience: string;
  waveId: string | null;
  severity: string;
  status: string;
  publishAt: string | null;
  expiresAt: string | null;
  publishedAt: string | null;
  readAt?: string | null;
}>;

function iso(value: unknown): string | null {
  return value ? new Date(String(value)).toISOString() : null;
}

function priority(input: {
  category: string;
  sentiment: string;
  score: number;
}): "low" | "normal" | "high" | "critical" {
  if (input.category === "safety" && input.score <= 2) return "critical";
  if (["bug", "performance"].includes(input.category)
    && input.sentiment === "negative"
    && input.score <= 2) return "high";
  if (input.sentiment === "positive" && input.score >= 4) return "low";
  return "normal";
}

export class BetaCommunityService extends EconomyRepositoryBase {
  async submitFeedback(input: {
    userId: string;
    idempotencyKey: string;
    category: string;
    sentiment: "negative" | "neutral" | "positive";
    score: number;
    summary: string;
    details: string;
  }): Promise<Readonly<{ feedbackKey: string; status: string }>> {
    const result = await this.idempotent(
      `beta-feedback:${input.idempotencyKey}`,
      input.userId,
      input,
      async (tx) => {
        const waves = await tx`
          SELECT member.wave_id
          FROM beta_wave_members member
          JOIN beta_rollout_waves wave ON wave.id=member.wave_id
          WHERE member.user_id=${input.userId}::uuid
            AND member.status IN ('active','completed','paused')
          ORDER BY wave.activated_at DESC NULLS LAST,wave.created_at DESC
          LIMIT 1
        `;
        const id = randomUUID();
        const feedbackKey = `FB-${new Date().getUTCFullYear()}-${id.slice(0,8).toUpperCase()}`;
        const feedbackPriority = priority(input);
        const rows = await tx`
          INSERT INTO beta_feedback (
            id,feedback_key,user_id,wave_id,category,sentiment,score,
            summary,details,priority
          ) VALUES (
            ${id}::uuid,${feedbackKey},${input.userId}::uuid,
            ${waves[0]?.wave_id ? String(waves[0].wave_id) : null}::uuid,
            ${input.category},${input.sentiment},${input.score},
            ${input.summary.slice(0,500)},
            pgp_sym_encrypt(
              ${input.details.slice(0,8000)},${dataEncryptionKey()},'cipher-algo=aes256'
            ),
            ${feedbackPriority}
          )
          RETURNING feedback_key,status
        `;
        await this.outbox(tx, id, "beta.feedback.submitted", {
          feedbackKey,
          priority: feedbackPriority,
          category: input.category
        });
        return {
          feedbackKey: String(rows[0]?.feedback_key),
          status: String(rows[0]?.status)
        };
      }
    );
    await this.syncCommunityGate(input.userId);
    return result;
  }

  async updateFeedback(input: {
    actorId: string;
    feedbackId: string;
    status: "new" | "reviewing" | "planned" | "resolved" | "dismissed";
    priority: "low" | "normal" | "high" | "critical";
    note: string;
    assignedTo?: string | undefined;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE beta_feedback SET
          status=${input.status},priority=${input.priority},
          assigned_to=COALESCE(${input.assignedTo ?? null}::uuid,assigned_to),
          reviewed_at=CASE
            WHEN ${input.status} IN ('planned','resolved','dismissed')
            THEN COALESCE(reviewed_at,now()) ELSE reviewed_at END,
          updated_at=now()
        WHERE id=${input.feedbackId}::uuid
        RETURNING id
      `;
      if (!rows[0]) throw new Error("Feedback não encontrado.");
      await tx`
        INSERT INTO beta_feedback_updates (id,feedback_id,status,note,created_by)
        VALUES (
          ${randomUUID()}::uuid,${input.feedbackId}::uuid,${input.status},
          ${input.note.slice(0,4000)},${input.actorId}::uuid
        )
      `;
    });
    await this.syncCommunityGate(input.actorId);
  }

  async createAnnouncement(input: {
    actorId: string;
    title: string;
    body: string;
    audience: "all" | "beta" | "wave" | "admins";
    waveId?: string | undefined;
    severity: "info" | "success" | "warning" | "critical";
    publishAt?: string | undefined;
    expiresAt?: string | undefined;
    idempotencyKey: string;
  }): Promise<CommunityAnnouncementView> {
    if (input.audience === "wave" && !input.waveId) {
      throw new Error("Anúncio de onda exige waveId.");
    }
    if (input.publishAt && input.expiresAt
      && new Date(input.expiresAt) <= new Date(input.publishAt)) {
      throw new Error("A expiração deve ocorrer depois da publicação.");
    }
    return this.idempotent(
      `community-announcement:${input.idempotencyKey}`,
      input.actorId,
      input,
      async (tx) => {
        const id = randomUUID();
        const key = `COM-${new Date().getUTCFullYear()}-${id.slice(0,8).toUpperCase()}`;
        const rows = await tx`
          INSERT INTO community_announcements (
            id,announcement_key,title,body,audience,wave_id,severity,status,
            publish_at,expires_at,created_by
          ) VALUES (
            ${id}::uuid,${key},${input.title.slice(0,200)},${input.body.slice(0,8000)},
            ${input.audience},${input.waveId ?? null}::uuid,${input.severity},
            ${input.publishAt ? "scheduled" : "draft"},${input.publishAt ?? null},
            ${input.expiresAt ?? null},${input.actorId}::uuid
          )
          RETURNING *
        `;
        return this.mapAnnouncement(rows[0]);
      }
    );
  }

  async publishAnnouncement(input: {
    actorId: string;
    announcementId: string;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE community_announcements SET
          status='published',publish_at=COALESCE(publish_at,now()),
          published_at=now(),published_by=${input.actorId}::uuid,updated_at=now()
        WHERE id=${input.announcementId}::uuid AND status IN ('draft','scheduled')
        RETURNING id,title,audience,wave_id
      `;
      const row = rows[0];
      if (!row) throw new Error("Anúncio não encontrado ou já publicado.");
      await this.outbox(tx, input.announcementId, "community.announcement.published", {
        title: row.title,
        audience: row.audience,
        waveId: row.wave_id
      });
    });
    await this.syncCommunityGate(input.actorId);
  }

  async announcementsFor(userId: string): Promise<readonly CommunityAnnouncementView[]> {
    const rows = await this.sql`
      SELECT announcement.*,read_state.read_at
      FROM community_announcements announcement
      LEFT JOIN community_announcement_reads read_state
        ON read_state.announcement_id=announcement.id
       AND read_state.user_id=${userId}::uuid
      WHERE announcement.status='published'
        AND announcement.publish_at<=now()
        AND (announcement.expires_at IS NULL OR announcement.expires_at>now())
        AND (
          announcement.audience IN ('all','beta')
          OR (announcement.audience='wave' AND EXISTS (
            SELECT 1 FROM beta_wave_members member
            WHERE member.wave_id=announcement.wave_id
              AND member.user_id=${userId}::uuid
          ))
        )
      ORDER BY
        CASE announcement.severity
          WHEN 'critical' THEN 0 WHEN 'warning' THEN 1
          WHEN 'success' THEN 2 ELSE 3 END,
        announcement.published_at DESC
      LIMIT 100
    `;
    return rows.map((row) => ({
      ...this.mapAnnouncement(row),
      readAt: iso(row.read_at)
    }));
  }

  async markAnnouncementRead(input: {
    userId: string;
    announcementId: string;
  }): Promise<void> {
    await this.sql`
      INSERT INTO community_announcement_reads (announcement_id,user_id)
      SELECT id,${input.userId}::uuid
      FROM community_announcements
      WHERE id=${input.announcementId}::uuid AND status='published'
      ON CONFLICT (announcement_id,user_id) DO UPDATE SET read_at=now()
    `;
  }

  async communityReadiness(): Promise<BetaCommunityReadiness> {
    const [announcements, feedback] = await Promise.all([
      this.sql`
        SELECT count(*)::int total FROM community_announcements
        WHERE status='published' AND audience IN ('all','beta','wave')
          AND publish_at<=now() AND (expires_at IS NULL OR expires_at>now())
      `,
      this.sql`
        SELECT count(*)::int total FROM beta_feedback
        WHERE priority='critical' AND status IN ('new','reviewing')
      `
    ]);
    return evaluateBetaCommunityReadiness({
      activeAnnouncement: Number(announcements[0]?.total ?? 0) > 0,
      unresolvedCriticalFeedback: Number(feedback[0]?.total ?? 0)
    });
  }

  async syncCommunityGate(actorId?: string): Promise<void> {
    const state = await this.communityReadiness();
    await this.sql`
      UPDATE release_gate_checks SET
        status=${state.ready ? "passing" : "blocked"},
        evidence=${JSON.stringify(state)}::jsonb,checked_at=now(),
        updated_by=${actorId ?? null}::uuid,updated_at=now()
      WHERE gate_key='beta-community-operations-ready'
    `;
  }

  async processScheduledAnnouncements(): Promise<number> {
    const published = await this.sql`
      UPDATE community_announcements SET
        status='published',published_at=now(),updated_at=now()
      WHERE status='scheduled' AND publish_at<=now()
        AND (expires_at IS NULL OR expires_at>now())
      RETURNING id
    `;
    const expired = await this.sql`
      UPDATE community_announcements SET status='expired',updated_at=now()
      WHERE status='published' AND expires_at IS NOT NULL AND expires_at<=now()
      RETURNING id
    `;
    if (published.length || expired.length) await this.syncCommunityGate();
    return published.length;
  }

  protected async feedbackRows(limit = 300): Promise<readonly BetaFeedbackView[]> {
    const rows = await this.sql`
      SELECT feedback.*,user_account.email,
        pgp_sym_decrypt(feedback.details,${dataEncryptionKey()}) details_plaintext
      FROM beta_feedback feedback
      JOIN users user_account ON user_account.id=feedback.user_id
      ORDER BY
        CASE feedback.priority
          WHEN 'critical' THEN 0 WHEN 'high' THEN 1
          WHEN 'normal' THEN 2 ELSE 3 END,
        feedback.created_at DESC
      LIMIT ${Math.min(Math.max(limit,1),500)}
    `;
    return rows.map((row) => ({
      id: String(row.id),feedbackKey: String(row.feedback_key),
      userId: String(row.user_id),userEmail: String(row.email),
      waveId: row.wave_id ? String(row.wave_id) : null,
      category: String(row.category),sentiment: String(row.sentiment),
      score: Number(row.score),summary: String(row.summary),
      details: String(row.details_plaintext),status: String(row.status),
      priority: String(row.priority),
      assignedTo: row.assigned_to ? String(row.assigned_to) : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString()
    }));
  }

  protected async announcementRows(): Promise<readonly CommunityAnnouncementView[]> {
    const rows = await this.sql`
      SELECT * FROM community_announcements ORDER BY created_at DESC LIMIT 200
    `;
    return rows.map((row) => this.mapAnnouncement(row));
  }

  protected mapAnnouncement(
    row: Record<string,unknown> | undefined
  ): CommunityAnnouncementView {
    if (!row) throw new Error("Anúncio não pôde ser criado.");
    return {
      id: String(row.id),announcementKey: String(row.announcement_key),
      title: String(row.title),body: String(row.body),audience: String(row.audience),
      waveId: row.wave_id ? String(row.wave_id) : null,
      severity: String(row.severity),status: String(row.status),
      publishAt: iso(row.publish_at),expiresAt: iso(row.expires_at),
      publishedAt: iso(row.published_at)
    };
  }
}
