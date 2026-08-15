import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor } from "./auth-context.js";
import { publicCleanAssetUri } from "./ugc-binary-asset-routes.js";
import { publicVerifiedManifestUri } from "./ugc-asset-upload-routes.js";
import { deleteObject, getObject, objectStorageEnabled, putObject } from "./object-storage-s3.js";

const economySql = db();
const MAX_MANIFEST_BYTES = 1024 * 1024;
const assetRoleSchema = z.enum(["model", "texture", "thumbnail", "preview", "attachment"]);
const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });
const managedManifestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  assets: z.array(z.object({
    uploadId: z.string().uuid(),
    role: assetRoleSchema.default("attachment")
  })).min(1).max(64)
}).superRefine((value, context) => {
  const ids = new Set<string>();
  for (const [index, asset] of value.assets.entries()) {
    if (ids.has(asset.uploadId)) {
      context.addIssue({ code: "custom", path: ["assets", index, "uploadId"], message: "O mesmo asset não pode aparecer duas vezes no manifesto." });
    }
    ids.add(asset.uploadId);
  }
});

type CleanAssetRow = Readonly<{
  id: unknown;
  file_name: unknown;
  content_type: unknown;
  verified_size_bytes: unknown;
  verified_sha256: unknown;
}>;

type ManagedAssetDescriptor = Readonly<{
  uploadId: string;
  role: z.infer<typeof assetRoleSchema>;
  uri: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  fileName: string;
}>;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function manifestObjectKey(userId: string, uploadId: string): string {
  return `ugc/manifests/${userId}/${uploadId}.json`;
}

function descriptor(row: CleanAssetRow, role: z.infer<typeof assetRoleSchema>): ManagedAssetDescriptor {
  const uploadId = String(row.id);
  return {
    uploadId,
    role,
    uri: publicCleanAssetUri(uploadId),
    sha256: String(row.verified_sha256),
    sizeBytes: Number(row.verified_size_bytes),
    contentType: String(row.content_type),
    fileName: String(row.file_name)
  };
}

export async function registerUgcManagedManifestRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/ugc/assets/manifests/managed/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = listQuerySchema.parse(request.query);
    const rows = await economySql`
      SELECT managed.upload_id,managed.name,managed.asset_count,managed.created_at,
        upload.verified_sha256,upload.verified_size_bytes
      FROM ugc_managed_manifests managed
      JOIN ugc_asset_upload_sessions upload ON upload.id=managed.upload_id
      WHERE managed.owner_user_id=${actor.userId}::uuid AND upload.status='verified'
      ORDER BY managed.created_at DESC,managed.upload_id DESC
      LIMIT ${query.limit}
    `;
    return {
      manifests: rows.map((row) => ({
        uploadId: String(row.upload_id),
        name: String(row.name),
        assetCount: Number(row.asset_count),
        assetManifestUri: publicVerifiedManifestUri(String(row.upload_id)),
        sha256: String(row.verified_sha256),
        sizeBytes: Number(row.verified_size_bytes),
        createdAt: row.created_at,
        managed: true
      })),
      filter: { limit: query.limit },
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/ugc/assets/manifests/managed", async (request) => {
    if (!objectStorageEnabled()) throw app.httpErrors.serviceUnavailable("Object storage de UGC ainda não está habilitado.");
    const actor = await requireActor(app, request);
    const body = managedManifestSchema.parse(request.body);

    const assets: ManagedAssetDescriptor[] = await economySql.begin("isolation level repeatable read", async (tx) => {
      const resolved: ManagedAssetDescriptor[] = [];
      for (const asset of body.assets) {
        const row = (await tx`
          SELECT id,file_name,content_type,verified_size_bytes,verified_sha256
          FROM ugc_binary_asset_upload_sessions
          WHERE id=${asset.uploadId}::uuid AND owner_user_id=${actor.userId}::uuid AND status='clean'
          FOR SHARE
        `)[0] as CleanAssetRow | undefined;
        if (!row) throw app.httpErrors.notFound(`Asset clean do criador não encontrado: ${asset.uploadId}`);
        resolved.push(descriptor(row, asset.role));
      }
      return resolved;
    });

    const document = {
      schemaVersion: 1,
      kind: "nova-aurora-managed-asset-manifest",
      name: body.name,
      assets,
      integrity: { policy: "platform-clean-assets-only", assetCount: assets.length },
      signature: "Tehkné Solutions"
    } as const;
    const bytes = Buffer.from(JSON.stringify(document), "utf8");
    if (bytes.length < 2 || bytes.length > MAX_MANIFEST_BYTES) {
      throw app.httpErrors.badRequest("Manifesto gerenciado excede o limite de 1 MiB.");
    }

    const uploadId = randomUUID();
    const objectKey = manifestObjectKey(actor.userId, uploadId);
    const expectedSha = sha256(bytes);
    await putObject(objectKey, bytes, "application/json");
    try {
      const persisted = await getObject(objectKey);
      const persistedSha = sha256(persisted);
      if (persisted.length !== bytes.length || persistedSha !== expectedSha) {
        throw app.httpErrors.serviceUnavailable("Object storage não confirmou os mesmos bytes do manifesto gerenciado.");
      }

      await economySql.begin("isolation level serializable", async (tx) => {
        await tx`
          INSERT INTO ugc_asset_upload_sessions(
            id,owner_user_id,object_key,file_name,content_type,expected_size_bytes,declared_sha256,
            verified_size_bytes,verified_sha256,status,expires_at,verified_at,rejection_reason
          ) VALUES(
            ${uploadId}::uuid,${actor.userId}::uuid,${objectKey},${`managed-${uploadId}.json`},'application/json',
            ${persisted.length},${persistedSha},${persisted.length},${persistedSha},'verified',now() + interval '1 day',now(),NULL
          )
        `;
        await tx`
          INSERT INTO ugc_managed_manifests(upload_id,owner_user_id,name,asset_count)
          VALUES(${uploadId}::uuid,${actor.userId}::uuid,${body.name},${assets.length})
        `;
        for (const [ordinal, asset] of assets.entries()) {
          await tx`
            INSERT INTO ugc_managed_manifest_assets(manifest_upload_id,asset_upload_id,asset_role,ordinal)
            VALUES(${uploadId}::uuid,${asset.uploadId}::uuid,${asset.role},${ordinal})
          `;
        }
      });

      return {
        manifest: {
          uploadId,
          assetManifestUri: publicVerifiedManifestUri(uploadId),
          sha256: persistedSha,
          sizeBytes: persisted.length,
          verifiedByPlatform: true,
          managed: true,
          assets
        },
        signature: "Tehkné Solutions"
      };
    } catch (error) {
      await deleteObject(objectKey).catch(() => undefined);
      throw error;
    }
  });
}

// Tehkné Solutions
