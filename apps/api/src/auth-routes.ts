import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  authSecurity,
  bearerToken,
  requireIdentity,
  requestUserAgent
} from "./auth-context.js";

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
  displayName: z.string().min(2).max(120)
});

const heartbeatSchema = z.object({
  locationCode: z.string().min(1).max(80).optional(),
  status: z.enum(["online", "away", "busy"]).optional()
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/auth/register", async (request) => {
    const body = registerSchema.parse(request.body);
    return authSecurity.register({
      ...body,
      ipAddress: request.ip,
      userAgent: requestUserAgent(request),
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post("/v1/auth/login", async (request) => {
    const body = loginSchema.parse(request.body);
    return authSecurity.login({
      ...body,
      ipAddress: request.ip,
      userAgent: requestUserAgent(request)
    });
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
