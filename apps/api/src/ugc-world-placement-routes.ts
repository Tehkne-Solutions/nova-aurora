import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor } from "./auth-context.js";

const economySql = db();
const IMAGE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const GLB_CONTENT_TYPE = "model/gltf-binary" as const;
const RENDERABLE_CONTENT_TYPES = [...IMAGE_CONTENT_TYPES, GLB_CONTENT_TYPE] as const;
const ANIMATION_STATES = ["idle", "open", "close", "activate", "deactivate", "spin"] as const;

type RenderableContentType = typeof RENDERABLE_CONTENT_TYPES[number];
type RenderMode = "image-billboard-v1" | "glb-model-v1";
type AnimationState = typeof ANIMATION_STATES[number];

const placementQuerySchema = z.object({
  locationCode: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

const createPlacementSchema = z.object({
  assetId: z.string().uuid(),
  locationCode: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(80),
  offsetX: z.number().int().min(-120).max(120).default(0),
  offsetY: z.number().int().min(-140).max(80).default(-70),
  scalePercent: z.number().int().min(50).max(180).default(100),
  rotationYDegrees: z.number().int().min(0).max(359).default(0),
  animationState: z.enum(ANIMATION_STATES).default("idle")
});

const updateAnimationStateSchema = z.object({
  animationState: z.enum(ANIMATION_STATES)
});

function assetPath(assetId: string): string {
  return `/v1/ugc/assets/files/${assetId}`;
}

function assetUri(assetId: string): string | null {
  const base = (process.env.PUBLIC_API_URL ?? "").trim().replace(/\/$/, "");
  return base.startsWith("https://") ? `${base}${assetPath(assetId)}` : null;
}

function renderMode(contentType: string): RenderMode {
  return contentType === GLB_CONTENT_TYPE ? "glb-model-v1" : "image-billboard-v1";
}

function isRenderableContentType(value: string): value is RenderableContentType {
  return RENDERABLE_CONTENT_TYPES.includes(value as RenderableContentType);
}

function normalizeAnimationState(value: unknown): AnimationState {
  return ANIMATION_STATES.includes(value as AnimationState) ? value as AnimationState : "idle";
}

function serializePlacement(row: Record<string, unknown>) {
  const assetId = String(row.asset_upload_id);
  const contentType = String(row.content_type);
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    assetId,
    locationCode: String(row.location_code),
    locationName: String(row.location_name),
    label: String(row.label),
    offsetX: Number(row.offset_x),
    offsetY: Number(row.offset_y),
    scalePercent: Number(row.scale_percent),
    rotationYDegrees: Number(row.rotation_y_degrees ?? 0),
    animationState: normalizeAnimationState(row.animation_state),
    contentType,
    renderMode: renderMode(contentType),
    fileName: String(row.file_name),
    sha256: String(row.verified_sha256),
    assetPath: assetPath(assetId),
    assetUri: assetUri(assetId),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

export async function registerUgcWorldPlacementRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/ugc/world/locations", async () => {
    const rows = await economySql`
      SELECT location.code,location.name,location.location_type,
        district.code district_code,district.name district_name
      FROM city_locations location
      JOIN city_districts district ON district.id=location.district_id
      ORDER BY district.sort_order,location.map_y,location.map_x,location.code
    `;
    return {
      locations: rows.map((row) => ({
        code: String(row.code),
        name: String(row.name),
        locationType: String(row.location_type),
        districtCode: String(row.district_code),
        districtName: String(row.district_name)
      })),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/ugc/world/placements", async (request) => {
    const query = placementQuerySchema.parse(request.query);
    const rows = await economySql`
      SELECT placement.id,placement.owner_user_id,placement.asset_upload_id,
        placement.label,placement.offset_x,placement.offset_y,placement.scale_percent,
        placement.rotation_y_degrees,placement.animation_state,placement.created_at,placement.updated_at,
        location.code location_code,location.name location_name,
        asset.file_name,asset.content_type,asset.verified_sha256
      FROM ugc_world_placements placement
      JOIN city_locations location ON location.id=placement.location_id
      JOIN ugc_binary_asset_upload_sessions asset ON asset.id=placement.asset_upload_id
      WHERE placement.status='active'
        AND asset.status='clean'
        AND asset.content_type IN ('image/png','image/jpeg','image/webp','model/gltf-binary')
        AND (${query.locationCode ?? null}::text IS NULL OR location.code=${query.locationCode ?? null})
      ORDER BY location.code,placement.created_at,placement.id
      LIMIT ${query.limit}
    `;
    return {
      placements: rows.map((row) => serializePlacement(row)),
      filter: { locationCode: query.locationCode ?? null, limit: query.limit },
      renderMode: "image-billboard-v1" as const,
      renderModes: ["image-billboard-v1", "glb-model-v1"] as const,
      animationStates: ANIMATION_STATES,
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/ugc/world/placements/me", async (request) => {
    const actor = await requireActor(app, request);
    const rows = await economySql`
      SELECT placement.id,placement.owner_user_id,placement.asset_upload_id,
        placement.label,placement.offset_x,placement.offset_y,placement.scale_percent,
        placement.rotation_y_degrees,placement.animation_state,placement.created_at,placement.updated_at,
        location.code location_code,location.name location_name,
        asset.file_name,asset.content_type,asset.verified_sha256
      FROM ugc_world_placements placement
      JOIN city_locations location ON location.id=placement.location_id
      JOIN ugc_binary_asset_upload_sessions asset ON asset.id=placement.asset_upload_id
      WHERE placement.owner_user_id=${actor.userId}::uuid
        AND placement.status='active'
        AND asset.status='clean'
        AND asset.content_type IN ('image/png','image/jpeg','image/webp','model/gltf-binary')
      ORDER BY placement.created_at DESC,placement.id DESC
      LIMIT 200
    `;
    return { placements: rows.map((row) => serializePlacement(row)), animationStates: ANIMATION_STATES, signature: "Tehkné Solutions" };
  });

  app.post("/v1/ugc/world/placements", async (request) => {
    const actor = await requireActor(app, request);
    const body = createPlacementSchema.parse(request.body);
    const placementId = randomUUID();

    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const location = (await tx`
        SELECT id,code,name FROM city_locations WHERE code=${body.locationCode}
      `)[0];
      if (!location) throw app.httpErrors.notFound("Local da cidade não encontrado.");

      const asset = (await tx`
        SELECT id,owner_user_id,status,content_type,file_name,verified_sha256
        FROM ugc_binary_asset_upload_sessions
        WHERE id=${body.assetId}::uuid
        FOR SHARE
      `)[0];
      if (!asset) throw app.httpErrors.notFound("Asset UGC não encontrado.");
      if (String(asset.owner_user_id) !== actor.userId) {
        throw app.httpErrors.forbidden("Somente o proprietário pode colocar este asset no mundo.");
      }
      if (String(asset.status) !== "clean") {
        throw app.httpErrors.conflict("Somente assets limpos podem ser colocados no mundo.");
      }
      const contentType = String(asset.content_type);
      if (!isRenderableContentType(contentType)) {
        throw app.httpErrors.badRequest("O renderer atual aceita PNG, JPEG, WebP e GLB verificado.");
      }

      const count = Number((await tx`
        SELECT count(*)::int count
        FROM ugc_world_placements
        WHERE owner_user_id=${actor.userId}::uuid
          AND location_id=${String(location.id)}::uuid
          AND status='active'
      `)[0]?.count ?? 0);
      if (count >= 12) {
        throw app.httpErrors.conflict("Limite inicial de 12 objetos ativos por criador e local atingido.");
      }

      const row = (await tx`
        INSERT INTO ugc_world_placements (
          id,owner_user_id,asset_upload_id,location_id,label,
          offset_x,offset_y,scale_percent,rotation_y_degrees,animation_state,status
        ) VALUES (
          ${placementId}::uuid,${actor.userId}::uuid,${body.assetId}::uuid,${String(location.id)}::uuid,
          ${body.label},${body.offsetX},${body.offsetY},${body.scalePercent},${body.rotationYDegrees},${body.animationState},'active'
        )
        RETURNING id,owner_user_id,asset_upload_id,label,offset_x,offset_y,scale_percent,
          rotation_y_degrees,animation_state,created_at,updated_at
      `)[0]!;
      return { row, contentType, fileName: String(asset.file_name), sha256: String(asset.verified_sha256) };
    });

    return {
      placement: {
        id: String(result.row.id),
        ownerUserId: String(result.row.owner_user_id),
        assetId: String(result.row.asset_upload_id),
        locationCode: body.locationCode,
        label: String(result.row.label),
        offsetX: Number(result.row.offset_x),
        offsetY: Number(result.row.offset_y),
        scalePercent: Number(result.row.scale_percent),
        rotationYDegrees: Number(result.row.rotation_y_degrees),
        animationState: normalizeAnimationState(result.row.animation_state),
        contentType: result.contentType,
        renderMode: renderMode(result.contentType),
        fileName: result.fileName,
        sha256: result.sha256,
        assetPath: assetPath(body.assetId),
        assetUri: assetUri(body.assetId),
        createdAt: new Date(String(result.row.created_at)).toISOString(),
        updatedAt: new Date(String(result.row.updated_at)).toISOString()
      },
      animationStates: ANIMATION_STATES,
      signature: "Tehkné Solutions"
    };
  });

  app.patch<{ Params: { placementId: string } }>("/v1/ugc/world/placements/:placementId/animation-state", async (request) => {
    const actor = await requireActor(app, request);
    const placementId = z.string().uuid().parse(request.params.placementId);
    const body = updateAnimationStateSchema.parse(request.body);
    const row = (await economySql`
      UPDATE ugc_world_placements placement
      SET animation_state=${body.animationState},updated_at=now()
      FROM ugc_binary_asset_upload_sessions asset
      WHERE placement.id=${placementId}::uuid
        AND placement.owner_user_id=${actor.userId}::uuid
        AND placement.status='active'
        AND asset.id=placement.asset_upload_id
        AND asset.status='clean'
        AND asset.content_type='model/gltf-binary'
      RETURNING placement.id,placement.animation_state,placement.updated_at
    `)[0];
    if (!row) throw app.httpErrors.notFound("Placement GLB ativo e controlável não encontrado.");
    return {
      placementId: String(row.id),
      animationState: normalizeAnimationState(row.animation_state),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
      animationStates: ANIMATION_STATES,
      signature: "Tehkné Solutions"
    };
  });

  app.delete<{ Params: { placementId: string } }>("/v1/ugc/world/placements/:placementId", async (request) => {
    const actor = await requireActor(app, request);
    const placementId = z.string().uuid().parse(request.params.placementId);
    const current = (await economySql`
      SELECT id,status FROM ugc_world_placements
      WHERE id=${placementId}::uuid AND owner_user_id=${actor.userId}::uuid
    `)[0];
    if (!current) throw app.httpErrors.notFound("Placement UGC não encontrado.");
    if (String(current.status) === "removed") {
      return { removed: false, placementId, signature: "Tehkné Solutions" };
    }
    await economySql`
      UPDATE ugc_world_placements SET status='removed',updated_at=now()
      WHERE id=${placementId}::uuid AND owner_user_id=${actor.userId}::uuid
    `;
    return { removed: true, placementId, signature: "Tehkné Solutions" };
  });
}

// Tehkné Solutions
