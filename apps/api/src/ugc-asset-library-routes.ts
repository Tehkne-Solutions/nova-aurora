import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor } from "./auth-context.js";
import { registerUgcWorldPlacementRoutes } from "./ugc-world-placement-routes.js";

const economySql = db();

const assetStatusSchema = z.enum(["pending", "scanning", "clean", "infected", "rejected", "expired"]);
const assetListQuerySchema = z.object({
  status: assetStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

function assetPath(uploadId: string): string {
  return `/v1/ugc/assets/files/${uploadId}`;
}

function assetUri(uploadId: string): string | null {
  const base = (process.env.PUBLIC_API_URL ?? "").trim().replace(/\/$/, "");
  return base.startsWith("https://") ? `${base}${assetPath(uploadId)}` : null;
}

export async function registerUgcAssetLibraryRoutes(app: FastifyInstance): Promise<void> {
  await registerUgcWorldPlacementRoutes(app);

  app.get("/v1/ugc/assets/library/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = assetListQuerySchema.parse(request.query);
    const rows = await economySql`
      SELECT id,file_name,content_type,expected_size_bytes,declared_sha256,
        verified_size_bytes,verified_sha256,status,scanner_engine,rejection_reason,
        expires_at,scanned_at,promoted_at,created_at,updated_at
      FROM ugc_binary_asset_upload_sessions
      WHERE owner_user_id=${actor.userId}::uuid
        AND (${query.status ?? null}::text IS NULL OR status=${query.status ?? null})
      ORDER BY created_at DESC,id DESC
      LIMIT ${query.limit}
    `;

    return {
      assets: rows.map((row) => {
        const status = String(row.status);
        const id = String(row.id);
        const clean = status === "clean";
        return {
          id,
          fileName: String(row.file_name),
          contentType: String(row.content_type),
          status,
          expectedSizeBytes: Number(row.expected_size_bytes),
          verifiedSizeBytes: row.verified_size_bytes === null ? null : Number(row.verified_size_bytes),
          declaredSha256: String(row.declared_sha256),
          verifiedSha256: row.verified_sha256 === null ? null : String(row.verified_sha256),
          scannerEngine: row.scanner_engine === null ? null : String(row.scanner_engine),
          rejectionReason: row.rejection_reason === null ? null : String(row.rejection_reason),
          expiresAt: new Date(String(row.expires_at)).toISOString(),
          scannedAt: row.scanned_at === null ? null : new Date(String(row.scanned_at)).toISOString(),
          promotedAt: row.promoted_at === null ? null : new Date(String(row.promoted_at)).toISOString(),
          createdAt: new Date(String(row.created_at)).toISOString(),
          updatedAt: new Date(String(row.updated_at)).toISOString(),
          assetPath: clean ? assetPath(id) : null,
          assetUri: clean ? assetUri(id) : null
        };
      }),
      filter: { status: query.status ?? null, limit: query.limit },
      allowedContentTypes: ["image/png", "image/jpeg", "image/webp", "model/gltf-binary"],
      maxBytes: 25 * 1024 * 1024,
      signature: "Tehkné Solutions"
    };
  });
}

// Tehkné Solutions
