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
  signature: "Tehkné Solutions"
};
await writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
