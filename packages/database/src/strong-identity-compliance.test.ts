import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import {
  closeDb,
  db,
  EconomyIntegrityService,
  PrivacyComplianceService,
  StrongIdentityService
} from "./index.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
process.env.DATA_ENCRYPTION_KEY ??= "ci-data-encryption-key-12345678901234567890";
process.env.ALLOW_RECOVERY_TOKEN_RESPONSE = "true";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string): Buffer {
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of value.replace(/[^A-Z2-7]/g, "")) {
    accumulator = (accumulator << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totp(secret: string): string {
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 15;
  const binary = ((digest[offset]! & 127) << 24)
    | ((digest[offset + 1]! & 255) << 16)
    | ((digest[offset + 2]! & 255) << 8)
    | (digest[offset + 3]! & 255);
  return String(binary % 1_000_000).padStart(6, "0");
}

test(
  "ativa TOTP, exige segundo fator e recupera a senha revogando sessões",
  { skip: !databaseAvailable },
  async () => {
    const identity = new StrongIdentityService();
    const id = randomUUID();
    const email = `mfa-${id}@nova-aurora.local`;
    const registration = await identity.register({
      email,
      displayName: "Cidadão MFA",
      password: "PrimeiraSenha@2026",
      idempotencyKey: `register:${id}`,
      ipAddress: "127.0.0.31",
      userAgent: "sprint13-test"
    });

    const setup = await identity.startMfaSetup(registration.identity);
    const confirmed = await identity.confirmMfaSetup(
      registration.identity,
      totp(setup.secret)
    );
    assert.equal(confirmed.recoveryCodes.length, 10);

    await identity.logout({ token: registration.token });
    const login = await identity.loginSecure({
      email,
      password: "PrimeiraSenha@2026",
      deviceName: "CI",
      ipAddress: "127.0.0.31",
      userAgent: "sprint13-test"
    });
    assert.ok("requiresMfa" in login && login.requiresMfa);
    if (!("requiresMfa" in login)) throw new Error("MFA deveria ser exigido.");
    const authenticated = await identity.completeMfaLogin({
      challenge: login.challenge,
      code: totp(setup.secret),
      deviceName: "CI",
      ipAddress: "127.0.0.31",
      userAgent: "sprint13-test"
    });
    assert.equal(authenticated.identity.email, email);

    const recovery = await identity.requestPasswordRecovery({
      email,
      ipAddress: "127.0.0.31"
    });
    assert.ok(recovery.token);
    await identity.confirmPasswordRecovery({
      token: recovery.token!,
      newPassword: "NovaSenhaSegura@2026",
      ipAddress: "127.0.0.31",
      userAgent: "sprint13-test"
    });
    await assert.rejects(() => identity.authenticateToken(authenticated.token));

    const nextLogin = await identity.loginSecure({
      email,
      password: "NovaSenhaSegura@2026",
      ipAddress: "127.0.0.31",
      userAgent: "sprint13-test"
    });
    assert.ok("requiresMfa" in nextLogin);
  }
);

test(
  "atende exportação, carência de exclusão e cancelamento pelo titular",
  { skip: !databaseAvailable },
  async () => {
    const identity = new StrongIdentityService();
    const privacy = new PrivacyComplianceService();
    const id = randomUUID();
    const registration = await identity.register({
      email: `privacy-${id}@nova-aurora.local`,
      displayName: "Cidadão Privacidade",
      password: "Privacidade@2026",
      idempotencyKey: `register:${id}`
    });

    await privacy.setConsent({
      identity: registration.identity,
      purpose: "analytics",
      version: "2026-07",
      status: "granted"
    });
    const exported = await privacy.requestExport(registration.identity);
    assert.equal(typeof exported.data, "object");

    const deletion = await privacy.scheduleDeletion({
      identity: registration.identity,
      reason: "Teste de carência."
    });
    assert.ok(new Date(deletion.scheduledFor).getTime() > Date.now());
    assert.equal(
      (await identity.authenticateToken(registration.token)).userId,
      registration.identity.userId
    );
    const cancelled = await privacy.cancelDeletion(registration.identity);
    assert.equal(cancelled.deletionScheduledAt, null);
    assert.equal(cancelled.requests[0]?.status, "cancelled");
  }
);

test(
  "bloqueia ordens acima do limite e exige segunda aprovação",
  { skip: !databaseAvailable },
  async () => {
    const integrity = new EconomyIntegrityService();
    const sql = db();
    const users = await sql`
      SELECT id,email FROM users
      WHERE email IN ('alice@nova-aurora.local','bob@nova-aurora.local')
      ORDER BY email
    `;
    const alice = users.find((row) => String(row.email).startsWith("alice"));
    const bob = users.find((row) => String(row.email).startsWith("bob"));
    assert.ok(alice && bob);
    const items = await sql`SELECT id FROM items WHERE code='bread'`;
    const itemId = String(items[0]?.id);
    assert.ok(itemId);

    const original = await sql`
      SELECT max_order_gross_minor FROM market_controls WHERE item_id=${itemId}::uuid
    `;
    await sql`
      UPDATE market_controls SET max_order_gross_minor=100,status='open',
        reference_price_minor=NULL WHERE item_id=${itemId}::uuid
    `;
    try {
      const denied = await integrity.preflightOrder({
        ownerId: String(alice.id),
        itemId,
        side: "buy",
        quantityMinor: 100,
        unitPriceMinor: 101
      });
      assert.equal(denied.allowed, false);
      assert.match(denied.reason ?? "", /limite por operação/i);
    } finally {
      await sql`
        UPDATE market_controls SET max_order_gross_minor=${Number(original[0]?.max_order_gross_minor ?? 5000000)}
        WHERE item_id=${itemId}::uuid
      `;
    }

    const requestId = await integrity.proposeChange({
      actorId: String(alice.id),
      itemCode: "bread",
      changeType: "limits",
      payload: { maxOrderGrossMinor: 5000000 },
      reason: "Teste de governança com dupla aprovação."
    });
    await assert.rejects(() => integrity.approveChange({
      actorId: String(alice.id),
      requestId
    }));
    await integrity.approveChange({ actorId: String(bob.id), requestId });
    const changes = await sql`
      SELECT status,approved_by FROM market_control_change_requests WHERE id=${requestId}::uuid
    `;
    assert.equal(String(changes[0]?.status), "applied");
    assert.equal(String(changes[0]?.approved_by), String(bob.id));
  }
);

test.after(async () => {
  await closeDb();
});
