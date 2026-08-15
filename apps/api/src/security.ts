import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  authSecurity,
  requireIdentity,
  requestUserAgent
} from "./auth-context.js";
import { enforceReleaseGate } from "./release-gate.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type RequestIdentity = Readonly<{
  actorUserId: string;
  subjectUserId: string;
  sessionId: string;
}>;

const requestIdentities = new WeakMap<FastifyRequest, RequestIdentity>();
const VERIFIED_MANIFEST_PATH = /^\/v1\/ugc\/assets\/manifests\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLEAN_BINARY_ASSET_PATH = /^\/v1\/ugc\/assets\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPublicIdentityPath(path: string): boolean {
  return path === "/v1/auth/login"
    || path === "/v1/auth/register"
    || path === "/v1/auth/refresh"
    || path === "/v1/auth/logout"
    || path === "/v1/realtime"
    || path === "/v1/trust/public"
    || path === "/v1/trust/reports"
    || path === "/v1/trust/guardian/decision"
    || path === "/v1/status/public";
}

function isPublicImmutableUgcAsset(method: string, path: string): boolean {
  return (method === "GET" || method === "HEAD")
    && (VERIFIED_MANIFEST_PATH.test(path) || CLEAN_BINARY_ASSET_PATH.test(path));
}

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?", 1)[0] ?? request.url;
    if (!path.startsWith("/v1/")) return;

    const authorization = request.headers.authorization ?? "anonymous";
    const scopeKey = hash(`${request.ip}:${authorization.slice(0, 96)}`);
    try {
      const sensitivePublic = path === "/v1/trust/reports"
        || path === "/v1/trust/guardian/decision";
      await authSecurity.consumeRateLimit({
        scopeKey,
        action: `api:${request.method}:${path}`,
        limit: path === "/v1/auth/register" ? 4 : sensitivePublic ? 12 : 180,
        windowSeconds: 60,
        blockSeconds: path === "/v1/auth/register" ? 900 : sensitivePublic ? 300 : 60
      });
    } catch {
      throw app.httpErrors.tooManyRequests(
        "Limite de requisições excedido. Tente novamente mais tarde."
      );
    }

    if (
      isPublicIdentityPath(path)
      || isPublicImmutableUgcAsset(request.method, path)
      || path.startsWith("/v1/auth/")
      || path.startsWith("/v1/live/")
    ) {
      return;
    }

    const identity = await requireIdentity(app, request);
    let subject = identity;
    const context = request.headers["x-actor-context"];
    if (typeof context === "string" && context.trim().length > 0) {
      try {
        subject = await authSecurity.assumeContext({
          identity,
          targetEmail: context,
          ipAddress: request.ip,
          userAgent: requestUserAgent(request)
        });
      } catch (error) {
        throw app.httpErrors.forbidden(
          error instanceof Error ? error.message : "Contexto não autorizado."
        );
      }
    }

    await enforceReleaseGate(app, request, subject);
    request.headers["x-actor-email"] = subject.email;
    requestIdentities.set(request, {
      actorUserId: identity.userId,
      subjectUserId: subject.userId,
      sessionId: identity.sessionId
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    const identity = requestIdentities.get(request);
    if (!identity || request.method === "GET" || request.method === "HEAD") return;
    await authSecurity.audit({
      actorUserId: identity.actorUserId,
      subjectUserId: identity.subjectUserId,
      sessionId: identity.sessionId,
      action: `api.${request.method.toLowerCase()}`,
      resourceType: "route",
      resourceId: request.routeOptions.url,
      outcome: reply.statusCode < 400 ? "success" : "failure",
      riskLevel: reply.statusCode >= 500 ? "high" : "low",
      ipAddress: request.ip,
      userAgent: requestUserAgent(request),
      metadata: { statusCode: reply.statusCode }
    });
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const path = request.url.split("?", 1)[0] ?? request.url;
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    reply.header(
      "cache-control",
      isPublicImmutableUgcAsset(request.method, path)
        ? "public,max-age=31536000,immutable"
        : "no-store"
    );
    reply.header(
      "content-security-policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );
    return payload;
  });
}

// Tehkné Solutions
