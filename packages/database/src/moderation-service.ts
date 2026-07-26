import { createHash, randomUUID } from "node:crypto";
import { dataEncryptionKey } from "./data-protection.js";
import { EconomyRepositoryBase } from "./economy-base.js";

export type TrustReportView = Readonly<{
  id: string;
  reportKey: string;
  category: string;
  subjectType: string;
  subjectReference: string | null;
  summary: string;
  details: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class ModerationService extends EconomyRepositoryBase {
  async submitReport(input: {
    submissionKey: string;
    reporterUserId?: string | undefined;
    category: string;
    subjectType: string;
    subjectReference?: string | undefined;
    summary: string;
    details: string;
    metadata?: unknown;
  }): Promise<Readonly<{ reportKey: string; status: string }>> {
    const payloadHash = sha256(JSON.stringify({
      category: input.category,
      subjectType: input.subjectType,
      subjectReference: input.subjectReference ?? null,
      summary: input.summary,
      details: input.details
    }));
    const reportId = randomUUID();
    const reportKey = `REP-${new Date().getUTCFullYear()}-${reportId.slice(0, 8).toUpperCase()}`;
    const priority = input.category === "minor-safety" || input.category === "security"
      ? "high" : "normal";
    const rows = await this.sql`
      INSERT INTO trust_reports (
        id,report_key,submission_key,payload_hash,reporter_user_id,category,
        subject_type,subject_reference,summary,details,priority,metadata
      ) VALUES (
        ${reportId}::uuid,${reportKey},${input.submissionKey},${payloadHash},
        ${input.reporterUserId ?? null}::uuid,${input.category},${input.subjectType},
        ${input.subjectReference ?? null},${input.summary.slice(0,500)},
        pgp_sym_encrypt(${input.details.slice(0,8000)},${dataEncryptionKey()},'cipher-algo=aes256'),
        ${priority},${JSON.stringify(input.metadata ?? {})}::jsonb
      )
      ON CONFLICT (submission_key) DO UPDATE SET submission_key=EXCLUDED.submission_key
      RETURNING report_key,payload_hash,status
    `;
    const row = rows[0];
    if (!row) throw new Error("Denúncia não pôde ser registrada.");
    if (String(row.payload_hash) !== payloadHash) {
      throw new Error("Idempotency-Key reutilizada com outro conteúdo.");
    }
    return { reportKey: String(row.report_key), status: String(row.status) };
  }

  async updateReport(input: {
    actorId: string;
    reportId: string;
    status: "open" | "triaged" | "investigating" | "actioned" | "closed" | "dismissed";
    priority: "low" | "normal" | "high" | "critical";
    note: string;
    actionCode?: string | undefined;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = await tx`
        UPDATE trust_reports SET status=${input.status},priority=${input.priority},
          assigned_to=COALESCE(assigned_to,${input.actorId}::uuid),updated_at=now(),
          closed_at=CASE WHEN ${input.status} IN ('closed','dismissed') THEN now() ELSE NULL END
        WHERE id=${input.reportId}::uuid RETURNING id
      `;
      if (!rows[0]) throw new Error("Denúncia não encontrada.");
      await tx`
        INSERT INTO trust_report_updates (id,report_id,status,note,action_code,created_by)
        VALUES (${randomUUID()}::uuid,${input.reportId}::uuid,${input.status},
          ${input.note.slice(0,4000)},${input.actionCode ?? null},${input.actorId}::uuid)
      `;
    });
  }

  async reports(limit = 300): Promise<readonly TrustReportView[]> {
    const rows = await this.sql`
      SELECT report.*,pgp_sym_decrypt(report.details,${dataEncryptionKey()}) details_plaintext
      FROM trust_reports report ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        created_at DESC LIMIT ${Math.min(Math.max(limit, 1), 500)}
    `;
    return rows.map((row) => ({
      id: String(row.id), reportKey: String(row.report_key),
      category: String(row.category), subjectType: String(row.subject_type),
      subjectReference: row.subject_reference ? String(row.subject_reference) : null,
      summary: String(row.summary), details: String(row.details_plaintext),
      priority: String(row.priority), status: String(row.status),
      assignedTo: row.assigned_to ? String(row.assigned_to) : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString()
    }));
  }
}
