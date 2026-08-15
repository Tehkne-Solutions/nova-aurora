import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const apiUrl = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const reportFile = process.env.BINARY_ASSET_QA_REPORT ?? "binary-asset-scan-report.json";
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

const login = await requireJson("/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password, deviceName: "release-qa-binary-asset" })
});
const token = String(login?.token ?? "");
if (!token) throw new Error("Login de QA não retornou bearer token.");
const authHeaders = { authorization: `Bearer ${token}` };

// 1x1 PNG válido e pequeno, suficiente para assinatura de formato e scan antimalware real.
const cleanBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const cleanSha = createHash("sha256").update(cleanBytes).digest("hex");
const nonce = randomUUID();

const session = await requireJson("/v1/ugc/assets/files/uploads", {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/json" },
  body: JSON.stringify({
    fileName: `release-qa-${nonce}.png`,
    contentType: "image/png",
    sizeBytes: cleanBytes.length,
    sha256: cleanSha
  })
});
const upload = session?.upload;
if (!upload?.id || !upload?.path || upload.method !== "POST" || upload.quarantine !== true) {
  throw new Error("Sessão binária não retornou contrato de quarentena esperado.");
}

const uploadResponse = await requestJson(upload.path, {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/octet-stream" },
  body: new Uint8Array(cleanBytes)
});
if (!uploadResponse.response.ok) {
  throw new Error(`Upload binário limpo falhou (${uploadResponse.response.status}): ${uploadResponse.text.slice(0, 1000)}`);
}
const asset = uploadResponse.payload?.asset;
if (!asset || asset.uploadId !== upload.id || asset.sha256 !== cleanSha || asset.malwareScan !== "clean") {
  throw new Error("Asset promovido não confirmou SHA-256 + malwareScan=clean.");
}
if (!String(asset.assetUri ?? "").startsWith("https://")) throw new Error("URI canônica do asset limpo precisa ser HTTPS.");

const publicResponse = await fetch(`${apiUrl}/v1/ugc/assets/files/${upload.id}`);
if (!publicResponse.ok) throw new Error(`GET público do asset clean falhou (${publicResponse.status}).`);
const publicBytes = Buffer.from(await publicResponse.arrayBuffer());
if (!publicBytes.equals(cleanBytes)) throw new Error("GET público não preservou os bytes binários promovidos.");
if (publicResponse.headers.get("content-type")?.split(";", 1)[0] !== "image/png") {
  throw new Error("GET público não preservou o content-type do asset.");
}
if (!publicResponse.headers.get("cache-control")?.includes("immutable")) {
  throw new Error("Asset clean público não recebeu cache immutable.");
}
if (publicResponse.headers.get("x-content-type-options") !== "nosniff") {
  throw new Error("Asset clean público não recebeu nosniff.");
}

const invalidBytes = Buffer.from("not-a-png-binary-asset", "utf8");
const invalidSha = createHash("sha256").update(invalidBytes).digest("hex");
const invalidSession = await requireJson("/v1/ugc/assets/files/uploads", {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/json" },
  body: JSON.stringify({
    fileName: `invalid-${nonce}.png`,
    contentType: "image/png",
    sizeBytes: invalidBytes.length,
    sha256: invalidSha
  })
});
const invalidUpload = invalidSession?.upload;
if (!invalidUpload?.id || !invalidUpload?.path) throw new Error("Sessão inválida de QA não foi criada.");
const invalidResult = await requestJson(invalidUpload.path, {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/octet-stream" },
  body: new Uint8Array(invalidBytes)
});
if (invalidResult.response.status !== 400) {
  throw new Error(`Magic inválido deveria retornar 400, recebeu ${invalidResult.response.status}.`);
}
const invalidPublic = await fetch(`${apiUrl}/v1/ugc/assets/files/${invalidUpload.id}`);
if (invalidPublic.status !== 404) {
  throw new Error(`Asset rejeitado não pode ser público; esperado 404, recebeu ${invalidPublic.status}.`);
}

const library = await requireJson("/v1/ugc/assets/library/me?limit=100", { headers: authHeaders });
if (!Array.isArray(library?.assets)) throw new Error("Biblioteca do criador não retornou uma lista de assets.");
const cleanLibraryAsset = library.assets.find((entry) => entry.id === upload.id);
if (!cleanLibraryAsset || cleanLibraryAsset.status !== "clean") {
  throw new Error("Asset limpo não apareceu na biblioteca autenticada do próprio criador.");
}
if (cleanLibraryAsset.verifiedSha256 !== cleanSha || cleanLibraryAsset.assetPath !== `/v1/ugc/assets/files/${upload.id}`) {
  throw new Error("Biblioteca não preservou SHA-256 verificado + caminho público canônico do asset limpo.");
}
if (!String(cleanLibraryAsset.assetUri ?? "").startsWith("https://")) {
  throw new Error("Biblioteca não expôs URI HTTPS para o asset limpo.");
}
const rejectedLibraryAsset = library.assets.find((entry) => entry.id === invalidUpload.id);
if (!rejectedLibraryAsset || rejectedLibraryAsset.status !== "rejected") {
  throw new Error("Asset rejeitado não apareceu com status seguro na biblioteca do criador.");
}
if (rejectedLibraryAsset.assetPath !== null || rejectedLibraryAsset.assetUri !== null) {
  throw new Error("Asset rejeitado recebeu referência pública indevida na biblioteca.");
}
const libraryJson = JSON.stringify(library);
for (const forbidden of ["quarantine_object_key", "clean_object_key", "scanner_signature"]) {
  if (libraryJson.includes(forbidden)) throw new Error(`Biblioteca expôs metadado privado proibido: ${forbidden}.`);
}

const bundleManifest = {
  schemaVersion: 1,
  kind: "nova-aurora-ugc-asset-bundle",
  blueprint: { name: `Bundle QA ${nonce}`, category: "component", version: 1 },
  assets: [{
    assetId: upload.id,
    role: "primary",
    uri: cleanLibraryAsset.assetUri,
    sha256: cleanSha,
    contentType: "image/png",
    sizeBytes: cleanBytes.length,
    fileName: `release-qa-${nonce}.png`
  }],
  integrity: { assetPolicy: "clean-only", algorithm: "sha256" },
  signature: "Tehkné Solutions"
};
const bundleBytes = Buffer.from(JSON.stringify(bundleManifest), "utf8");
const bundleSha = createHash("sha256").update(bundleBytes).digest("hex");
const manifestSession = await requireJson("/v1/ugc/assets/manifests/uploads", {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/json" },
  body: JSON.stringify({ fileName: `bundle-${nonce}.json`, sizeBytes: bundleBytes.length, sha256: bundleSha })
});
const manifestUpload = manifestSession?.upload;
if (!manifestUpload?.id || !manifestUpload?.path || manifestUpload.method !== "POST") {
  throw new Error("Compositor QA não recebeu sessão válida de upload do manifesto.");
}
const manifestResponse = await requestJson(manifestUpload.path, {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/octet-stream" },
  body: new Uint8Array(bundleBytes)
});
if (!manifestResponse.response.ok) {
  throw new Error(`Upload do manifesto composto falhou (${manifestResponse.response.status}): ${manifestResponse.text.slice(0, 1000)}`);
}
const verifiedManifest = manifestResponse.payload?.manifest;
if (!verifiedManifest?.verifiedByPlatform || verifiedManifest.uploadId !== manifestUpload.id || verifiedManifest.sha256 !== bundleSha) {
  throw new Error("Manifesto composto não foi confirmado byte a byte pelo object storage.");
}
if (!String(verifiedManifest.assetManifestUri ?? "").startsWith("https://")) {
  throw new Error("Manifesto composto verificado não recebeu URI canônica HTTPS.");
}

const blueprint = await requireJson("/v1/ugc/studio/blueprints", {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/json" },
  body: JSON.stringify({
    name: `Bundle QA ${nonce}`,
    category: "component",
    version: 1,
    assetManifestUri: verifiedManifest.assetManifestUri,
    contentHash: bundleSha,
    royaltyBps: 500,
    tokenizationStatus: "disabled",
    verifiedUploadId: manifestUpload.id
  })
});
const blueprintId = String(blueprint?.blueprint?.id ?? "");
if (!blueprintId) throw new Error("Blueprint do bundle composto não retornou ID.");
if (blueprint?.integrity?.verifiedUploadId !== manifestUpload.id || blueprint?.integrity?.remoteVerification !== true) {
  throw new Error("Blueprint do bundle não confirmou binding atômico ao manifesto verificado.");
}
const blueprintInventory = await requireJson("/v1/ugc/studio/blueprints/me?limit=200", { headers: authHeaders });
const boundBlueprint = blueprintInventory?.blueprints?.find((entry) => String(entry.id) === blueprintId);
if (!boundBlueprint || String(boundBlueprint.verified_upload_id ?? "") !== manifestUpload.id || String(boundBlueprint.verified_upload_status ?? "") !== "verified") {
  throw new Error("Inventário não preservou asset bundle → manifesto → blueprint verificado.");
}

const worldLocations = await requireJson("/v1/ugc/world/locations");
const targetLocation = worldLocations?.locations?.find((entry) => entry.code === "event-plaza") ?? worldLocations?.locations?.[0];
if (!targetLocation?.code) throw new Error("Catálogo de locais do mundo não retornou um destino para QA.");

const placementResponse = await requireJson("/v1/ugc/world/placements", {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/json" },
  body: JSON.stringify({
    assetId: upload.id,
    locationCode: targetLocation.code,
    label: `Objeto QA ${nonce.slice(0, 8)}`,
    offsetX: 18,
    offsetY: -92,
    scalePercent: 110
  })
});
const placementId = String(placementResponse?.placement?.id ?? "");
if (!placementId || placementResponse?.placement?.assetId !== upload.id) {
  throw new Error("Placement do asset clean não retornou identidade canônica.");
}
if (placementResponse?.placement?.assetPath !== `/v1/ugc/assets/files/${upload.id}`) {
  throw new Error("Placement clean não preservou o caminho público canônico do asset.");
}

const publicPlacements = await requireJson(`/v1/ugc/world/placements?locationCode=${encodeURIComponent(targetLocation.code)}&limit=200`);
const visiblePlacement = publicPlacements?.placements?.find((entry) => entry.id === placementId);
if (!visiblePlacement || visiblePlacement.assetId !== upload.id || visiblePlacement.sha256 !== cleanSha) {
  throw new Error("Runtime público não expôs exatamente o placement clean criado.");
}
if (publicPlacements?.renderMode !== "image-billboard-v1") {
  throw new Error("Runtime UGC não declarou o renderer image-billboard-v1 esperado.");
}

const rejectedPlacementAttempt = await requestJson("/v1/ugc/world/placements", {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/json" },
  body: JSON.stringify({
    assetId: invalidUpload.id,
    locationCode: targetLocation.code,
    label: `Rejeitado QA ${nonce.slice(0, 8)}`,
    offsetX: 0,
    offsetY: -70,
    scalePercent: 100
  })
});
if (rejectedPlacementAttempt.response.status !== 409) {
  throw new Error(`Asset rejeitado deveria ser bloqueado no placement com 409, recebeu ${rejectedPlacementAttempt.response.status}.`);
}

const ownPlacements = await requireJson("/v1/ugc/world/placements/me", { headers: authHeaders });
if (!ownPlacements?.placements?.some((entry) => entry.id === placementId)) {
  throw new Error("Placement clean não apareceu no inventário autenticado do criador.");
}

const removal = await requireJson(`/v1/ugc/world/placements/${placementId}`, {
  method: "DELETE",
  headers: authHeaders
});
if (removal?.removed !== true) throw new Error("Remoção do placement não confirmou transição para removed.");
const afterRemoval = await requireJson(`/v1/ugc/world/placements?locationCode=${encodeURIComponent(targetLocation.code)}&limit=200`);
if (afterRemoval?.placements?.some((entry) => entry.id === placementId)) {
  throw new Error("Placement removido continuou exposto ao runtime público.");
}

const report = {
  status: "passed",
  cleanUploadId: upload.id,
  cleanSha256: cleanSha,
  sizeBytes: cleanBytes.length,
  contentType: "image/png",
  malwareScan: "clean",
  publicReadbackExact: true,
  immutableCache: true,
  invalidMagicRejected: true,
  rejectedAssetNotPublic: true,
  creatorAssetLibraryVisible: true,
  cleanAssetLibraryCanonical: true,
  rejectedAssetLibraryFailClosed: true,
  privateStorageMetadataHidden: true,
  composedManifestUploadId: manifestUpload.id,
  composedManifestSha256: bundleSha,
  composedBlueprintId: blueprintId,
  cleanAssetManifestBlueprintChain: true,
  atomicBundleBlueprintBinding: true,
  worldPlacementId: placementId,
  worldPlacementLocationCode: targetLocation.code,
  cleanImageWorldPlacementVisible: true,
  rejectedImageWorldPlacementBlocked: true,
  removedPlacementNotPublic: true,
  worldRenderMode: "image-billboard-v1",
  signature: "Tehkné Solutions"
};
await writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
