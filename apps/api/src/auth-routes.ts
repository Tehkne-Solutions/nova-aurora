import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AccountDeliveryService,
  RegistrationReleaseService
} from "@nova-aurora/database";
import {
  authSecurity,
  bearerToken,
  requireIdentity,
  requestUserAgent
} from "./auth-context.js";

const release = new RegistrationReleaseService();
const accountDelivery = new AccountDeliveryService();

function idempotencyKey(app: FastifyInstance, request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return value;
}

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(256),
  deviceName: z.string().min(2).max(120).optional()
});

const registerSchema = loginSchema.extend({
  displayName: z.string().min(2).max(120),
  inviteCode: z.string().min(8).max(160).optional()
});

const mfaChallengeSchema = z.object({
  challenge: z.string().min(32).max(256),
  code: z.string().min(6).max(32),
  deviceName: z.string().min(2).max(120).optional()
});

const mfaCodeSchema = z.object({
  code: z.string().min(6).max(32)
});

const mfaDisableSchema = mfaCodeSchema.extend({
  password: z.string().min(12).max(256)
});

const recoveryRequestSchema = z.object({
  email: z.string().email().max(254)
});

const recoveryConfirmSchema = z.object({
  token: z.string().min(32).max(256),
  newPassword: z.string().min(12).max(256)
});

const verificationConfirmSchema = z.object({
  token: z.string().min(32).max(256)
});

const heartbeatSchema = z.object({
  locationCode: z.string().min(1).max(80).optional(),
  status: z.enum(["online", "away", "busy"]).optional()
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/auth/register", async (request) => {
    const body = registerSchema.parse(request.body);
    const key = idempotencyKey(app, request);
    const replay = await release.isRegistrationReplay(key);
    if (!replay) await release.assertRegistrationAllowed(body.email, body.inviteCode);
    const session = await authSecurity.register({
      email: body.email,
      displayName: body.displayName,
      password: body.password,
      deviceName: body.deviceName,
      ipAddress: request.ip,
      userAgent: requestUserAgent(request),
      idempotencyKey: key
    });
    const releaseState = replay
      ? await release.securityState(session.identity.userId)
      : await release.completeRegistration({
          identity: session.identity,
          inviteCode: body.inviteCode,
          ipAddress: request.ip,
          idempotencyKey: key
        });
    return {
      ...session,
      release: releaseState,
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/auth/login", async (request) => {
    const body = loginSchema.parse(request.body);
    return authSecurity.loginSecure({
      ...body,
      ipAddress: request.ip,
      userAgent: requestUserAgent(request)
    });
  });

  app.post("/v1/auth/mfa/complete", async (request) => {
    const body = mfaChallengeSchema.parse(request.body);
    return authSecurity.completeMfaLogin({
      ...body,
      ipAddress: request.ip,
      userAgent: requestUserAgent(request)
    });
  });

  app.post("/v1/auth/recovery/request", async (request) => {
    const body = recoveryRequestSchema.parse(request.body);
    const result = await accountDelivery.requestPasswordRecovery({
      email: body.email,
      ipAddress: request.ip
    });
    return {
      ...result,
      message: "Se a conta existir, as instruções foram encaminhadas ao e-mail cadastrado.",
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/auth/recovery/confirm", async (request, reply) => {
    const body = recoveryConfirmSchema.parse(request.body);
    await authSecurity.confirmPasswordRecovery({
      ...body,
      ipAddress: request.ip,
      userAgent: requestUserAgent(request)
    });
    return reply.status(204).send();
  });

  app.post("/v1/auth/email-verification/confirm", async (request) => {
    const body = verificationConfirmSchema.parse(request.body);
    return {
      ...(await release.confirmEmail(body.token)),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/auth/refresh", async (request) => {
    const token = bearerToken(app, request);
    return authSecurity.rotateSession({
      token,
      ipAddress: request.ip,
      userAgent: requestUserAgent(request),
      deviceName: typeof request.headers["x-device-name"] === "string"
        ? request.headers["x-device-name"]
        : undefined
    });
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    await authSecurity.logout({
      token: bearerToken(app, request),
      ipAddress: request.ip,
      userAgent: requestUserAgent(request)
    });
    return reply.status(204).send();
  });

  app.get("/v1/auth/me", async (request) =>
    requireIdentity(app, request)
  );

  app.get("/v1/auth/security-state", async (request) => {
    const identity = await requireIdentity(app, request);
    return {
      security: await release.securityState(identity.userId),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/auth/email-verification/resend", async (request) => {
    const identity = await requireIdentity(app, request);
    return {
      ...(await release.resendVerification({ identity, ipAddress: request.ip })),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/auth/mfa/setup", async (request) => {
    const identity = await requireIdentity(app, request);
    return {
      ...(await authSecurity.startMfaSetup(identity)),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/auth/mfa/confirm", async (request) => {
    const identity = await requireIdentity(app, request);
    const body = mfaCodeSchema.parse(request.body);
    return {
      ...(await authSecurity.confirmMfaSetup(identity, body.code)),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/auth/mfa/disable", async (request, reply) => {
    const identity = await requireIdentity(app, request);
    const body = mfaDisableSchema.parse(request.body);
    await authSecurity.disableMfa({ identity, ...body });
    return reply.status(204).send();
  });

  app.post("/v1/auth/realtime-ticket", async (request) => {
    const identity = await requireIdentity(app, request);
    return {
      ...(await authSecurity.createRealtimeTicket(identity)),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/auth/notifications", async (request) => {
    const identity = await requireIdentity(app, request);
    return {
      notifications: await authSecurity.notifications(identity.userId),
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { notificationId: string } }>(
    "/v1/auth/notifications/:notificationId/read",
    async (request, reply) => {
      const identity = await requireIdentity(app, request);
      await authSecurity.markNotificationRead(
        identity.userId,
        request.params.notificationId
      );
      return reply.status(204).send();
    }
  );

  app.post("/v1/live/heartbeat", async (request) => {
    const identity = await requireIdentity(app, request);
    const body = heartbeatSchema.parse(request.body ?? {});
    return {
      presence: await authSecurity.heartbeat({
        identity,
        ...(body.locationCode === undefined ? {} : { locationCode: body.locationCode }),
        ...(body.status === undefined ? {} : { status: body.status })
      }),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/live/presence", async (request) => {
    await requireIdentity(app, request);
    return {
      presence: await authSecurity.presence(),
      signature: "Tehkné Solutions"
    };
  });
}
