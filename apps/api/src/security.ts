import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { authSecurity } from "./auth-context.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?", 1)[0] ?? request.url;
    if (!path.startsWith("/v1/") || path === "/v1/auth/login") return;

    const authorization = request.headers.authorization ?? "anonymous";
    const scopeKey = hash(`${request.ip}:${authorization.slice(0, 96)}`);
    try {
      await authSecurity.consumeRateLimit({
        scopeKey,
        action: `api:${request.method}:${path}`,
        limit: path === "/v1/auth/register" ? 4 : 180,
        windowSeconds: 60,
        blockSeconds: path === "/v1/auth/register" ? 900 : 60
      });
    } catch {
      throw app.httpErrors.tooManyRequests(
        "Limite de requisições excedido. Tente novamente mais tarde."
      );
    }
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    reply.header("cache-control", "no-store");
    reply.header(
      "content-security-policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );
    return payload;
  });
}
