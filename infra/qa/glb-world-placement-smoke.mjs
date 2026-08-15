import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const apiUrl = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const reportFile = process.env.GLB_PLACEMENT_QA_REPORT ?? "glb-world-placement-report.json";
const email = process.env.E2E_EMAIL ?? "alice@nova-aurora.local";
const password = process.env.E2E_PASSWORD ?? "Aurora@2026";

async function requestJson(path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, init);
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  }
  return { response, payload, text };
}

async function requireJson(path, init = {}) {
  const result = await requestJson(path, init);
  if (!result.response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} falhou (${result.response.status}): ${result.text.slice(0, 1000)}`);
  }
  return result.payload;
}

function padded(buffer, fill = 0x20) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(padding, fill)]);
}

function triangleGlb() {
  const positions = Buffer.alloc(36);
  const vertices = [
    -0.7, -0.55, 0,
    0.7, -0.55, 0,
    0, 0.75, 0
  ];
  vertices.forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const binary = padded(positions, 0);
  const document = {
    asset: { version: "2.0", generator: "Nova Aurora GLB QA · Tehkné Solutions" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 4 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.31, 0.74, 0.59, 1] } }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-0.7, -0.55, 0], max: [0.7, 0.75, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 }],
    buffers: [{ byteLength: positions.length }]
  };
  const json = padded(Buffer.from(JSON.stringify(document), "utf8"));
  const length = 12 + 8 + json.length + 8 + binary.length;
  const glb = Buffer.alloc(length);
  glb.write("glTF", 0, "ascii");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  const binHeader = 20 + json.length;
  glb.writeUInt32LE(binary.length, binHeader);
  glb.writeUInt32LE(0x004e4942, binHeader + 4);
  binary.copy(glb, binHeader + 8);
  return glb;
}

const login = await requireJson("/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password, deviceName: "release-qa-glb-placement" })
});
const token = String(login?.token ?? "");
if (!token) throw new Error("Login de QA GLB não retornou bearer token.");
const authHeaders = { authorization: `Bearer ${token}` };

const nonce = randomUUID();
const glbBytes = triangleGlb();
const glbSha = createHash("sha256").update(glbBytes).digest("hex");
const session = await requireJson("/v1/ugc/assets/files/uploads", {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/json" },
  body: JSON.stringify({
    fileName: `world-triangle-${nonce}.glb`,
    contentType: "model/gltf-binary",
    sizeBytes: glbBytes.length,
    sha256: glbSha
  })
});
const upload = session?.upload;
if (!upload?.id || !upload?.path || upload.quarantine !== true) {
  throw new Error("Sessão GLB não retornou contrato de quarentena esperado.");
}

const uploadResult = await requestJson(upload.path, {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/octet-stream" },
  body: new Uint8Array(glbBytes)
});
if (!uploadResult.response.ok) {
  throw new Error(`Upload GLB falhou (${uploadResult.response.status}): ${uploadResult.text.slice(0, 1000)}`);
}
const asset = uploadResult.payload?.asset;
if (!asset || asset.uploadId !== upload.id || asset.sha256 !== glbSha || asset.contentType !== "model/gltf-binary" || asset.malwareScan !== "clean") {
  throw new Error("GLB promovido não confirmou SHA-256, MIME e malwareScan=clean.");
}

const publicAsset = await fetch(`${apiUrl}/v1/ugc/assets/files/${upload.id}`);
if (!publicAsset.ok) throw new Error(`GET público do GLB clean falhou (${publicAsset.status}).`);
const publicBytes = Buffer.from(await publicAsset.arrayBuffer());
if (!publicBytes.equals(glbBytes)) throw new Error("GET público do GLB não preservou os bytes exatos.");
if (publicAsset.headers.get("content-type")?.split(";", 1)[0] !== "model/gltf-binary") {
  throw new Error("GET público do GLB não preservou model/gltf-binary.");
}

const library = await requireJson("/v1/ugc/assets/library/me?status=clean&limit=200", { headers: authHeaders });
const libraryGlb = library?.assets?.find((entry) => entry.id === upload.id);
if (!libraryGlb || libraryGlb.contentType !== "model/gltf-binary" || libraryGlb.verifiedSha256 !== glbSha) {
  throw new Error("GLB clean não apareceu corretamente na biblioteca do criador.");
}

const worldLocations = await requireJson("/v1/ugc/world/locations");
const targetLocation = worldLocations?.locations?.find((entry) => entry.code === "event-plaza") ?? worldLocations?.locations?.[0];
if (!targetLocation?.code) throw new Error("Catálogo de locais não retornou destino para placement GLB.");

const placementResponse = await requireJson("/v1/ugc/world/placements", {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/json" },
  body: JSON.stringify({
    assetId: upload.id,
    locationCode: targetLocation.code,
    label: `Modelo 3D QA ${nonce.slice(0, 8)}`,
    offsetX: -28,
    offsetY: -88,
    scalePercent: 125,
    rotationYDegrees: 135
  })
});
const placement = placementResponse?.placement;
const placementId = String(placement?.id ?? "");
if (!placementId || placement?.assetId !== upload.id) throw new Error("Placement GLB não retornou identidade canônica.");
if (placement?.renderMode !== "glb-model-v1" || placement?.contentType !== "model/gltf-binary") {
  throw new Error("POST do placement GLB não despachou glb-model-v1.");
}
if (placement?.rotationYDegrees !== 135) throw new Error("POST do placement GLB não preservou rotação de 135 graus.");

const publicPlacements = await requireJson(`/v1/ugc/world/placements?locationCode=${encodeURIComponent(targetLocation.code)}&limit=200`);
if (!Array.isArray(publicPlacements?.renderModes) || !publicPlacements.renderModes.includes("glb-model-v1")) {
  throw new Error("Contrato público não declarou suporte a glb-model-v1.");
}
const visible = publicPlacements?.placements?.find((entry) => entry.id === placementId);
if (!visible || visible.sha256 !== glbSha || visible.renderMode !== "glb-model-v1" || visible.rotationYDegrees !== 135) {
  throw new Error("Runtime público não expôs GLB clean com SHA, renderer e rotação canônicos.");
}
if (visible.assetPath !== `/v1/ugc/assets/files/${upload.id}`) {
  throw new Error("Placement GLB não preservou caminho público canônico.");
}

const ownPlacements = await requireJson("/v1/ugc/world/placements/me", { headers: authHeaders });
const own = ownPlacements?.placements?.find((entry) => entry.id === placementId);
if (!own || own.renderMode !== "glb-model-v1" || own.contentType !== "model/gltf-binary") {
  throw new Error("Inventário autenticado não preservou placement GLB.");
}

const removal = await requireJson(`/v1/ugc/world/placements/${placementId}`, {
  method: "DELETE",
  headers: authHeaders
});
if (removal?.removed !== true) throw new Error("Remoção do placement GLB não confirmou removed=true.");
const afterRemoval = await requireJson(`/v1/ugc/world/placements?locationCode=${encodeURIComponent(targetLocation.code)}&limit=200`);
if (afterRemoval?.placements?.some((entry) => entry.id === placementId)) {
  throw new Error("Placement GLB removido continuou público.");
}

const report = {
  status: "passed",
  glbUploadId: upload.id,
  glbSha256: glbSha,
  glbSizeBytes: glbBytes.length,
  glbVersion: 2,
  malwareScan: "clean",
  publicReadbackExact: true,
  creatorLibraryVisible: true,
  worldPlacementId: placementId,
  worldPlacementLocationCode: targetLocation.code,
  renderMode: "glb-model-v1",
  rotationYDegrees: 135,
  cleanGlbWorldPlacementVisible: true,
  removedGlbPlacementNotPublic: true,
  rendererContract: "first-party-webgl-v1",
  signature: "Tehkné Solutions"
};
await writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
