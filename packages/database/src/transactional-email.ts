import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import { dataEncryptionKey } from "./data-protection.js";

export type TransactionalEmailTemplate =
  | "verify-email"
  | "recover-account"
  | "beta-invite"
  | "security-alert";

export type TransactionalEmailView = Readonly<{
  id: string;
  recipient: string;
  template: string;
  subject: string;
  status: string;
  attempts: number;
  providerMessageId: string | null;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}>;

export async function enqueueTransactionalEmail(tx: Tx, input: {
  deliveryKey: string;
  userId?: string | null;
  recipient: string;
  template: TransactionalEmailTemplate;
  subject: string;
  payload: Readonly<Record<string, unknown>>;
}): Promise<string> {
  const id = randomUUID();
  const rows = await tx`
    INSERT INTO transactional_email_outbox (
      id,delivery_key,user_id,recipient,template,subject,payload_ciphertext
    ) VALUES (
      ${id}::uuid,${input.deliveryKey},${input.userId ?? null}::uuid,
      ${input.recipient.trim().toLowerCase()},${input.template},${input.subject},
      pgp_sym_encrypt(
        ${JSON.stringify(input.payload)},${dataEncryptionKey()},'cipher-algo=aes256'
      )
    )
    ON CONFLICT (delivery_key) DO UPDATE SET
      recipient=EXCLUDED.recipient,
      subject=EXCLUDED.subject,
      payload_ciphertext=EXCLUDED.payload_ciphertext,
      status=CASE
        WHEN transactional_email_outbox.status='sent' THEN transactional_email_outbox.status
        ELSE 'queued'
      END,
      next_attempt_at=CASE
        WHEN transactional_email_outbox.status='sent' THEN transactional_email_outbox.next_attempt_at
        ELSE now()
      END,
      updated_at=now()
    RETURNING id
  `;
  return String(rows[0]?.id ?? id);
}

function retrySeconds(attempts: number): number {
  return Math.min(3600, Math.max(30, 30 * 2 ** Math.max(0, attempts - 1)));
}

async function deliver(input: {
  id: string;
  recipient: string;
  template: string;
  subject: string;
  payload: Readonly<Record<string, unknown>>;
}): Promise<string> {
  const endpoint = process.env.TRANSACTIONAL_EMAIL_ENDPOINT?.trim();
  if (!endpoint) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TRANSACTIONAL_EMAIL_ENDPOINT não configurado.");
    }
    return `local-simulated:${input.id}`;
  }
  const from = process.env.TRANSACTIONAL_EMAIL_FROM?.trim();
  if (!from) throw new Error("TRANSACTIONAL_EMAIL_FROM não configurado.");
  const token = process.env.TRANSACTIONAL_EMAIL_TOKEN?.trim();
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from,
      to: input.recipient,
      subject: input.subject,
      template: input.template,
      data: input.payload,
      metadata: {
        application: "nova-aurora",
        deliveryId: input.id,
        signature: "Tehkné Solutions"
      }
    })
  });
  if (!response.ok) {
    throw new Error(`Provedor transacional respondeu HTTP ${response.status}.`);
  }
  const body = await response.json().catch(() => ({})) as { id?: unknown; messageId?: unknown };
  const messageId = body.id ?? body.messageId;
  return typeof messageId === "string" && messageId.length > 0
    ? messageId.slice(0, 240)
    : `provider-accepted:${input.id}`;
}

export class TransactionalEmailService extends EconomyRepositoryBase {
  async processDue(limit = 25): Promise<Readonly<{
    sent: number;
    failed: number;
    dead: number;
  }>> {
    await this.sql`
      UPDATE transactional_email_outbox
      SET status='failed',last_error='Entrega interrompida antes da confirmação.',
        next_attempt_at=now(),updated_at=now()
      WHERE status='sending' AND updated_at<now()-interval '15 minutes'
    `;
    const rows = await this.sql.begin(async (tx) => {
      const due = await tx`
        SELECT id,recipient,template,subject,attempts,
          pgp_sym_decrypt(payload_ciphertext,${dataEncryptionKey()}) payload
        FROM transactional_email_outbox
        WHERE status IN ('queued','failed') AND next_attempt_at<=now()
        ORDER BY created_at,id
        LIMIT ${Math.min(Math.max(limit,1),100)}
        FOR UPDATE SKIP LOCKED
      `;
      if (due.length > 0) {
        const ids = due.map((row) => String(row.id));
        await tx`
          UPDATE transactional_email_outbox
          SET status='sending',updated_at=now()
          WHERE id=ANY(${ids}::uuid[])
        `;
      }
      return due;
    });

    let sent = 0;
    let failed = 0;
    let dead = 0;
    for (const row of rows) {
      const id = String(row.id);
      const attempts = Number(row.attempts) + 1;
      try {
        const parsed = JSON.parse(String(row.payload)) as Readonly<Record<string, unknown>>;
        const providerMessageId = await deliver({
          id,
          recipient: String(row.recipient),
          template: String(row.template),
          subject: String(row.subject),
          payload: parsed
        });
        await this.sql`
          UPDATE transactional_email_outbox SET
            status='sent',attempts=${attempts},provider_message_id=${providerMessageId},
            last_error=NULL,sent_at=now(),updated_at=now()
          WHERE id=${id}::uuid
        `;
        sent += 1;
      } catch (error) {
        const isDead = attempts >= 5;
        const message = error instanceof Error ? error.message : "Falha desconhecida no provedor.";
        await this.sql`
          UPDATE transactional_email_outbox SET
            status=${isDead ? "dead" : "failed"},attempts=${attempts},
            last_error=${message.slice(0,1000)},
            next_attempt_at=now()+make_interval(secs=>${retrySeconds(attempts)}),
            updated_at=now()
          WHERE id=${id}::uuid
        `;
        if (isDead) dead += 1;
        else failed += 1;
      }
    }
    return { sent, failed, dead };
  }

  async recent(limit = 50): Promise<readonly TransactionalEmailView[]> {
    const rows = await this.sql`
      SELECT id,recipient,template,subject,status,attempts,provider_message_id,
        last_error,created_at,sent_at
      FROM transactional_email_outbox
      ORDER BY created_at DESC
      LIMIT ${Math.min(Math.max(limit,1),200)}
    `;
    return rows.map((row) => ({
      id: String(row.id),
      recipient: String(row.recipient),
      template: String(row.template),
      subject: String(row.subject),
      status: String(row.status),
      attempts: Number(row.attempts),
      providerMessageId: row.provider_message_id ? String(row.provider_message_id) : null,
      lastError: row.last_error ? String(row.last_error) : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
      sentAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : null
    }));
  }

  async retry(emailId: string): Promise<void> {
    const rows = await this.sql`
      UPDATE transactional_email_outbox SET
        status='queued',attempts=0,last_error=NULL,next_attempt_at=now(),updated_at=now()
      WHERE id=${emailId}::uuid AND status IN ('failed','dead')
      RETURNING id
    `;
    if (!rows[0]) throw new Error("Entrega não encontrada ou não pode ser reenviada.");
  }
}
