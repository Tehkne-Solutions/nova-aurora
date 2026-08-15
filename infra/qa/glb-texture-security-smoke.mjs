import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const apiUrl = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const reportFile = process.env.GLB_TEXTURE_QA_REPORT ?? "glb-texture-security-report.json";
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

function padded(buffer, fill = 0) {
  const padding = (4 - buffer.length % 4) % 4;
  return padding === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(padding, fill)]);
}

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function texturedTriangleGlb(imageBytes) {
  const positions = Buffer.alloc(36);
  const vertices = [-0.7, -0.55, 0, 0.7, -0.55, 0, 0, 0.75, 0];
  vertices.forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const imageOffset = positions.length;
  const binary = Buffer.concat([positions, padded(imageBytes, 0)]);
  const document = {
    asset: { version: "2.0", generator: "Nova Aurora embedded texture QA · Tehkné Solutions" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 4 }] }],
    materials: [{
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        baseColorTexture: { index: 0, texCoord: 0 }
      }
    }],
    textures: [{ source: 0 }],
    images: [{ bufferView: 1, mimeType: "image/png" }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length },
      { buffer: 0, byteOffset: imageOffset, byteLength: imageBytes.length }
    ],
    buffers: [{ byteLength: binary.length }]
  };
  const json = padded(Buffer.from(JSON.stringify(document), "utf8"), 0x20);
  const bin = padded(binary, 0);
  const length = 12 + 8 + json.length + 8 + bin.length;
  const glb = Buffer.alloc(length);
  glb.write("glTF", 0, "ascii");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  const binHeader = 20 + json.length;
  glb.writeUInt32LE(bin.length, binHeader);
  glb.writeUInt32LE(0x004e4942, binHeader + 4);
  bin.copy(glb, binHeader + 8);
  return glb;
}

async function createSession(authHeaders, fileName, bytes) {
  const sha = createHash("sha256").update(bytes).digest("hex");
  const session = await requireJson("/v1/ugc/assets/files/uploads", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      fileName,
      contentType: "model/gltf-binary",
      sizeBytes: bytes.length,
      sha256: sha
    })
  });
  if (!session?.upload?.id || !session?.upload?.path || session.upload.quarantine !== true) {
    throw new Error("Sessão GLB de textura não retornou contrato de quarentena esperado.");
  }
  return { upload: session.upload, sha };
}

const login = await requireJson("/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password, deviceName: "release-qa-glb-texture-security" })
});
const token = String(login?.token ?? "");
if (!token) throw new Error("Login de QA de textura GLB não retornou bearer token.");
const authHeaders = { authorization: `Bearer ${token}` };
const nonce = randomUUID();

const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4ZkAAAAASUVORK5CYII=",
  "base64"
);
const validGlb = texturedTriangleGlb(validPng);
const validSession = await createSession(authHeaders, `textured-triangle-${nonce}.glb`, validGlb);
const validResult = await requestJson(validSession.upload.path, {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/octet-stream" },
  body: new Uint8Array(validGlb)
});
if (!validResult.response.ok) {
  throw new Error(`GLB com PNG embutido válido falhou (${validResult.response.status}): ${validResult.text.slice(0, 1000)}`);
}
const validAsset = validResult.payload?.asset;
if (
  validAsset?.sha256 !== validSession.sha
  || validAsset?.malwareScan !== "clean"
  || validAsset?.contentType !== "model/gltf-binary"
) {
  throw new Error("GLB texturizado válido não confirmou SHA/MIME/ClamAV clean.");
}
const textureReport = validAsset?.glbTextureSecurity;
if (
  textureReport?.images !== 1
  || textureReport?.textures !== 1
  || textureReport?.referencedImages !== 1
  || textureReport?.totalDecodedPixels !== 1
  || textureReport?.maxWidth !== 1
  || textureReport?.maxHeight !== 1
  || !Array.isArray(textureReport?.formats)
  || !textureReport.formats.includes("image/png")
  || textureReport?.externalResources !== 0
) {
  throw new Error(`Relatório de textura GLB válida inesperado: ${JSON.stringify(textureReport)}`);
}
const validPublic = await fetch(`${apiUrl}/v1/ugc/assets/files/${validSession.upload.id}`);
if (!validPublic.ok) throw new Error(`GLB texturizado clean não ficou público (${validPublic.status}).`);
const validReadback = Buffer.from(await validPublic.arrayBuffer());
if (!validReadback.equals(validGlb)) throw new Error("Readback público do GLB texturizado não preservou bytes exatos.");

const bombPng = pngHeader(4097, 1);
const bombGlb = texturedTriangleGlb(bombPng);
const bombSession = await createSession(authHeaders, `texture-dimension-bomb-${nonce}.glb`, bombGlb);
const bombResult = await requestJson(bombSession.upload.path, {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/octet-stream" },
  body: new Uint8Array(bombGlb)
});
if (
  bombResult.response.status !== 400
  || !String(bombResult.payload?.message ?? "").includes("texture-dimension-limit")
) {
  throw new Error(`Dimension bomb de textura não foi rejeitada antes da promoção: ${bombResult.response.status} ${bombResult.text.slice(0, 800)}`);
}
const bombPublic = await fetch(`${apiUrl}/v1/ugc/assets/files/${bombSession.upload.id}`);
if (bombPublic.status !== 404) throw new Error(`GLB com texture dimension bomb ficou público (${bombPublic.status}).`);

const cleanLibrary = await requireJson("/v1/ugc/assets/library/me?status=clean&limit=100", { headers: authHeaders });
if (!cleanLibrary?.assets?.some((entry) => entry.id === validSession.upload.id)) {
  throw new Error("GLB texturizado válido não apareceu na biblioteca clean.");
}
if (cleanLibrary?.assets?.some((entry) => entry.id === bombSession.upload.id)) {
  throw new Error("GLB com texture dimension bomb apareceu na biblioteca clean.");
}

const report = {
  status: "passed",
  validTexturedGlbUploadId: validSession.upload.id,
  validTexturedGlbSha256: validSession.sha,
  validTextureSecurity: textureReport,
  validTexturePublicReadbackExact: true,
  textureDimensionBombUploadId: bombSession.upload.id,
  textureDimensionBombBlocked: true,
  textureDimensionBombPublicReadBlocked: true,
  textureDimensionBombCleanLibraryBlocked: true,
  promotionOrder: ["sha256", "glb-structure", "embedded-texture-security", "clamav", "clean-promotion"],
  textureRenderingEnabled: false,
  nextRendererContract: "embedded-textures-not-yet-rendered",
  signature: "Tehkné Solutions"
};
await writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
