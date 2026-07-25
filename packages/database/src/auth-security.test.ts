import assert from "node:assert/strict";
import test from "node:test";
import { closeDb, db, LiveSecurityService } from "./index.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

async function rejects(operation: () => Promise<unknown>): Promise<void> {
  await assert.rejects(operation);
}

test(
  "protege autenticação, contexto, tickets e rotação de sessão",
  { skip: !databaseAvailable },
  async () => {
    const security = new LiveSecurityService();
    const login = await security.login({
      email: "alice@nova-aurora.local",
      password: "Aurora@2026",
      ipAddress: "127.0.0.1",
      userAgent: "nova-aurora-test",
      deviceName: "CI"
    });

    assert.ok(login.token.length >= 40);
    assert.ok(login.identity.roles.includes("platform-admin"));
    const identity = await security.authenticateToken(login.token);
    assert.equal(identity.email, "alice@nova-aurora.local");

    const context = await security.assumeContext({
      identity,
      targetEmail: "bob@nova-aurora.local",
      ipAddress: "127.0.0.1",
      userAgent: "nova-aurora-test"
    });
    assert.equal(context.email, "bob@nova-aurora.local");
    assert.equal(context.sessionId, identity.sessionId);

    const realtime = await security.createRealtimeTicket(identity);
    const realtimeIdentity = await security.consumeRealtimeTicket(realtime.ticket);
    assert.equal(realtimeIdentity.userId, identity.userId);
    await rejects(() => security.consumeRealtimeTicket(realtime.ticket));

    const rotated = await security.rotateSession({
      token: login.token,
      ipAddress: "127.0.0.1",
      userAgent: "nova-aurora-test",
      deviceName: "CI rotated"
    });
    assert.notEqual(rotated.token, login.token);
    await rejects(() => security.authenticateToken(login.token));
    assert.equal(
      (await security.authenticateToken(rotated.token)).sessionId,
      rotated.identity.sessionId
    );

    await security.logout({
      token: rotated.token,
      ipAddress: "127.0.0.1",
      userAgent: "nova-aurora-test"
    });
    await rejects(() => security.authenticateToken(rotated.token));
  }
);

test(
  "cadastro idempotente não persiste token e limite permanece bloqueado",
  { skip: !databaseAvailable },
  async () => {
    const security = new LiveSecurityService();
    const run = crypto.randomUUID();
    const email = `security-${run}@nova-aurora.local`;
    const idempotencyKey = `register:${run}`;
    const first = await security.register({
      email,
      displayName: "Cidadão Segurança",
      password: "Seguranca@2026!",
      ipAddress: "127.0.0.2",
      userAgent: "nova-aurora-test",
      deviceName: "CI",
      idempotencyKey
    });
    const replay = await security.register({
      email,
      displayName: "Cidadão Segurança",
      password: "Seguranca@2026!",
      ipAddress: "127.0.0.2",
      userAgent: "nova-aurora-test",
      deviceName: "CI replay",
      idempotencyKey
    });
    assert.equal(first.identity.userId, replay.identity.userId);
    assert.notEqual(first.token, replay.token);

    const sql = db();
    const unsafeRows = await sql`
      SELECT response FROM idempotency_records WHERE key=${idempotencyKey}
    `;
    assert.equal(unsafeRows.length, 0);
    const safeRows = await sql`
      SELECT user_id FROM registration_idempotency WHERE idempotency_key=${idempotencyKey}
    `;
    assert.equal(String(safeRows[0]?.user_id), first.identity.userId);

    const scopeKey = `test-rate:${run}`;
    await security.consumeRateLimit({
      scopeKey,
      action: "test.security",
      limit: 1,
      windowSeconds: 60,
      blockSeconds: 60
    });
    await rejects(() => security.consumeRateLimit({
      scopeKey,
      action: "test.security",
      limit: 1,
      windowSeconds: 60,
      blockSeconds: 60
    }));
    await rejects(() => security.consumeRateLimit({
      scopeKey,
      action: "test.security",
      limit: 1,
      windowSeconds: 60,
      blockSeconds: 60
    }));
    const blockedRows = await sql`
      SELECT blocked_until FROM rate_limit_windows
      WHERE scope_key=${scopeKey} AND action='test.security'
      ORDER BY window_started_at DESC LIMIT 1
    `;
    assert.ok(blockedRows[0]?.blocked_until);

    await security.logout({ token: first.token });
    await security.logout({ token: replay.token });
  }
);

test.after(async () => {
  await closeDb();
});
