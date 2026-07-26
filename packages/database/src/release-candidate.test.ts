import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AccountDeliveryService,
  closeDb,
  db,
  RegistrationReleaseService,
  ReleaseOperationsService,
  StrongIdentityService,
  TransactionalEmailService
} from "./index.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
process.env.DATA_ENCRYPTION_KEY ??= "ci-data-encryption-key-12345678901234567890";
process.env.PUBLIC_WEB_URL ??= "http://localhost:3000";
process.env.PUBLIC_REGISTRATION_MODE = "open";
process.env.ALLOW_RECOVERY_TOKEN_RESPONSE = "true";

test(
  "exige verificação de e-mail antes de liberar operações mutáveis",
  { skip: !databaseAvailable },
  async () => {
    const identity = new StrongIdentityService();
    const release = new RegistrationReleaseService();
    const delivery = new TransactionalEmailService();
    const id = randomUUID();
    const key = `release-register:${id}`;
    const registration = await identity.register({
      email: `release-${id}@nova-aurora.local`,
      displayName: "Cidadão Release",
      password: "ReleaseCandidate@2026",
      idempotencyKey: key,
      ipAddress: "127.0.0.41"
    });
    assert.equal(await release.isRegistrationReplay(key), true);
    const pending = await release.completeRegistration({
      identity: registration.identity,
      idempotencyKey: key,
      ipAddress: "127.0.0.41"
    });
    assert.equal(pending.emailVerified, false);
    assert.equal(pending.betaAccess, "invited");
    await assert.rejects(() => release.assertMutableAccess(registration.identity.userId));

    const sql = db();
    const messages = await sql`
      SELECT id,pgp_sym_decrypt(payload_ciphertext,${process.env.DATA_ENCRYPTION_KEY}) payload
      FROM transactional_email_outbox
      WHERE user_id=${registration.identity.userId}::uuid AND template='verify-email'
      ORDER BY created_at DESC LIMIT 1
    `;
    assert.ok(messages[0]);
    const payload = JSON.parse(String(messages[0]?.payload)) as { verificationUrl: string };
    const token = new URL(payload.verificationUrl).searchParams.get("token");
    assert.ok(token);

    const delivered = await delivery.processDue(10);
    assert.equal(delivered.sent, 1);
    await release.confirmEmail(token!);
    const active = await release.securityState(registration.identity.userId);
    assert.equal(active.emailVerified, true);
    assert.equal(active.betaAccess, "active");
    await release.assertMutableAccess(registration.identity.userId);
  }
);

test(
  "consome convite limitado e registra recuperação na fila transacional",
  { skip: !databaseAvailable },
  async () => {
    const sql = db();
    const admins = await sql`SELECT id FROM users WHERE email='alice@nova-aurora.local'`;
    const adminId = String(admins[0]?.id);
    assert.ok(adminId);
    const release = new RegistrationReleaseService();
    const operations = new ReleaseOperationsService();
    const identity = new StrongIdentityService();
    const recovery = new AccountDeliveryService();
    const id = randomUUID();
    const email = `invite-${id}@nova-aurora.local`;
    const created = await release.createInvite({
      actorId: adminId,
      label: "Convite unitário de CI",
      emailPattern: email,
      maxUses: 1,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    process.env.PUBLIC_REGISTRATION_MODE = "invite-only";
    try {
      await release.assertRegistrationAllowed(email, created.code);
      const registration = await identity.register({
        email,
        displayName: "Convidado CI",
        password: "ConviteSeguro@2026",
        idempotencyKey: `invite-register:${id}`
      });
      await release.completeRegistration({
        identity: registration.identity,
        inviteCode: created.code,
        idempotencyKey: `invite-register:${id}`
      });
      await assert.rejects(() => release.assertRegistrationAllowed(
        `second-${id}@nova-aurora.local`,
        created.code
      ));

      const request = await recovery.requestPasswordRecovery({ email });
      assert.ok(request.token);
      const queued = await sql`
        SELECT count(*)::int total FROM transactional_email_outbox
        WHERE user_id=${registration.identity.userId}::uuid
          AND template='recover-account' AND status='queued'
      `;
      assert.equal(Number(queued[0]?.total), 1);
      const summary = await operations.summary();
      assert.ok(summary.users.total >= 3);
      assert.equal(summary.registrationMode, "invite-only");
    } finally {
      process.env.PUBLIC_REGISTRATION_MODE = "open";
    }
  }
);

test.after(async () => {
  await closeDb();
});
