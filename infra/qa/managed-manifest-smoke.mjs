import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const apiUrl = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const sourceReportFile = process.env.BINARY_ASSET_QA_REPORT ?? "binary-asset-scan-report.json";
const reportFile = process.env.MANAGED_MANIFEST_QA_REPORT ?? "managed-manifest-report.json";
const email = process.env.E2E_EMAIL ?? "alice@nova-aurora.local";
const password = process.env.E2E_PASSWORD ?? "Aurora@2026";

async function request(path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, init);
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  }
  return { response, payload, text };
}

async function requireJson(path, init = {}) {
  const result = await request(path, init);
  if (!result.response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} falhou (${result.response.status}): ${result.text.slice(0, 1000)}`);
  }
  return result.payload;
}

const binaryReport = JSON.parse(await readFile(sourceReportFile, "utf8"));
const cleanUploadId = String(binaryReport.cleanUploadId ?? "");
const cleanSha256 = String(binaryReport.cleanSha256 ?? "");
if (!cleanUploadId || !cleanSha256) throw new Error("Relatório binário não contém asset clean reutilizável.");

const login = await requireJson("/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password, deviceName: "release-qa-managed-manifest" })
});
const token = String(login?.token ?? "");
if (!token) throw new Error("Login de QA não retornou bearer token.");
const authHeaders = { authorization: `Bearer ${token}` };

const library = await requireJson("/v1/ugc/assets/library/me?status=clean&limit=200", { headers: authHeaders });
const cleanAsset = library?.assets?.find((entry) => String(entry.id) === cleanUploadId);
if (!cleanAsset || String(cleanAsset.status) !== "clean") {
  throw new Error("Asset clean não apareceu na biblioteca autenticada do criador.");
}
if (String(cleanAsset.verifiedSha256) !== cleanSha256 || String(cleanAsset.contentType) !== "image/png") {
  throw new Error("Biblioteca clean retornou integridade ou MIME divergentes.");
}
if (!String(cleanAsset.assetUri ?? "").startsWith("https://")) {
  throw new Error("Biblioteca clean não retornou URI HTTPS canônica.");
}

const name = `Managed QA ${randomUUID()}`;
const composed = await requireJson("/v1/ugc/assets/manifests/managed", {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/json" },
  body: JSON.stringify({ name, assets: [{ uploadId: cleanUploadId, role: "thumbnail" }] })
});
const manifest = composed?.manifest;
if (!manifest?.uploadId || manifest.managed !== true || manifest.verifiedByPlatform !== true) {
  throw new Error("Composer não retornou manifesto managed + verifiedByPlatform.");
}
if (manifest.assets?.length !== 1 || String(manifest.assets[0]?.uploadId) !== cleanUploadId) {
  throw new Error("Composer não preservou exatamente o asset clean selecionado.");
}
if (String(manifest.assets[0]?.sha256) !== cleanSha256 || String(manifest.assets[0]?.role) !== "thumbnail") {
  throw new Error("Composer retornou hash ou papel divergente do asset clean.");
}
if (String(manifest.assets[0]?.uri) !== String(cleanAsset.assetUri)
  || String(manifest.assets[0]?.contentType) !== String(cleanAsset.contentType)
  || Number(manifest.assets[0]?.sizeBytes) !== Number(cleanAsset.verifiedSizeBytes)) {
  throw new Error("Composer divergiu dos metadados verificados da biblioteca clean.");
}

const canonical = new URL(String(manifest.assetManifestUri));
const publicManifestResponse = await fetch(`${apiUrl}${canonical.pathname}`);
if (!publicManifestResponse.ok) {
  throw new Error(`Manifesto managed público falhou (${publicManifestResponse.status}).`);
}
const publicBytes = Buffer.from(await publicManifestResponse.arrayBuffer());
const publicSha = createHash("sha256").update(publicBytes).digest("hex");
if (publicSha !== String(manifest.sha256)) throw new Error("Manifesto managed público não preservou o SHA-256 persistido.");
const document = JSON.parse(publicBytes.toString("utf8"));
if (document.kind !== "nova-aurora-managed-asset-manifest" || document.signature !== "Tehkné Solutions") {
  throw new Error("Documento managed público não possui contrato canônico esperado.");
}
if (document.integrity?.policy !== "platform-clean-assets-only" || document.integrity?.assetCount !== 1) {
  throw new Error("Documento managed público não declara a política clean-assets-only.");
}
const documentAsset = document.assets?.[0];
if (!documentAsset || String(documentAsset.uploadId) !== cleanUploadId || String(documentAsset.sha256) !== cleanSha256) {
  throw new Error("Documento managed público não referencia exatamente o asset aprovado.");
}
if (String(documentAsset.uri) !== String(cleanAsset.assetUri)
  || String(documentAsset.contentType) !== String(cleanAsset.contentType)
  || Number(documentAsset.sizeBytes) !== Number(cleanAsset.verifiedSizeBytes)) {
  throw new Error("Documento managed público divergiu da biblioteca clean.");
}

const managedLibrary = await requireJson("/v1/ugc/assets/manifests/managed/me?limit=200", { headers: authHeaders });
const managedItem = managedLibrary?.manifests?.find((entry) => String(entry.uploadId) === String(manifest.uploadId));
if (!managedItem || managedItem.managed !== true || Number(managedItem.assetCount) !== 1) {
  throw new Error("Manifesto gerenciado não apareceu no inventário autenticado do criador.");
}

const invalidBytes = Buffer.from("not-a-real-png-for-managed-manifest", "utf8");
const invalidSha = createHash("sha256").update(invalidBytes).digest("hex");
const rejectedSession = await requireJson("/v1/ugc/assets/files/uploads", {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/json" },
  body: JSON.stringify({
    fileName: `managed-rejected-${randomUUID()}.png`,
    contentType: "image/png",
    sizeBytes: invalidBytes.length,
    sha256: invalidSha
  })
});
const rejectedUploadId = String(rejectedSession?.upload?.id ?? "");
const rejectedPath = String(rejectedSession?.upload?.path ?? "");
if (!rejectedUploadId || !rejectedPath) throw new Error("Sessão destinada à rejeição não foi criada.");
const rejectedUpload = await request(rejectedPath, {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/octet-stream" },
  body: new Uint8Array(invalidBytes)
});
if (rejectedUpload.response.status !== 400) {
  throw new Error(`Asset com magic inválido deveria ser rejeitado com 400; recebeu ${rejectedUpload.response.status}.`);
}

const rejectedCompose = await request("/v1/ugc/assets/manifests/managed", {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/json" },
  body: JSON.stringify({
    name: `Should Fail ${randomUUID()}`,
    assets: [{ uploadId: rejectedUploadId, role: "attachment" }]
  })
});
if (rejectedCompose.response.status !== 404) {
  throw new Error(`Composer deveria negar asset rejected com 404; recebeu ${rejectedCompose.response.status}.`);
}

const report = {
  status: "passed",
  cleanUploadId,
  managedManifestUploadId: manifest.uploadId,
  managedManifestSha256: manifest.sha256,
  assetLibraryVerified: true,
  publicManifestReadbackExact: true,
  platformCleanAssetsOnly: true,
  rejectedAssetDenied: true,
  signature: "Tehkné Solutions"
};
await writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
