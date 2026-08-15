import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const apiUrl = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const reportFile = process.env.VERIFIED_UPLOAD_QA_REPORT ?? "verified-upload-report.json";
const email = process.env.E2E_EMAIL ?? "alice@nova-aurora.local";
const password = process.env.E2E_PASSWORD ?? "Aurora@2026";

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, init);
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  }
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} falhou (${response.status}): ${text.slice(0, 1000)}`);
  }
  return payload;
}

const login = await jsonRequest("/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password, deviceName: "release-qa-verified-upload" })
});
const token = String(login?.token ?? "");
if (!token) throw new Error("Login de QA não retornou bearer token.");
const authHeaders = { authorization: `Bearer ${token}` };

const nonce = randomUUID();
const manifest = {
  schemaVersion: 1,
  asset: { kind: "component", name: `Release QA ${nonce}` },
  files: [],
  signature: "Tehkné Solutions"
};
const bytes = Buffer.from(JSON.stringify(manifest), "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");

const session = await jsonRequest("/v1/ugc/assets/manifests/uploads", {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/json" },
  body: JSON.stringify({ fileName: `release-qa-${nonce}.json`, sizeBytes: bytes.length, sha256 })
});
const upload = session?.upload;
if (!upload?.id || !upload?.path || upload?.method !== "POST") {
  throw new Error("Sessão de upload não retornou contrato temporário esperado.");
}

const verifyResponse = await fetch(`${apiUrl}${upload.path}`, {
  method: "POST",
  headers: { "content-type": "application/octet-stream" },
  body: new Uint8Array(bytes)
});
const verifyText = await verifyResponse.text();
if (!verifyResponse.ok) {
  throw new Error(`Envio dos bytes falhou (${verifyResponse.status}): ${verifyText.slice(0, 1000)}`);
}
const verified = JSON.parse(verifyText)?.manifest;
if (!verified?.verifiedByPlatform || verified.sha256 !== sha256 || Number(verified.sizeBytes) !== bytes.length) {
  throw new Error("Resposta de verificação não corresponde aos bytes enviados.");
}
if (verified.uploadId !== upload.id) throw new Error("Upload verificado retornou ID divergente.");
if (!String(verified.assetManifestUri ?? "").startsWith("https://")) {
  throw new Error("URI canônica do manifesto verificado precisa ser HTTPS.");
}

const persistedResponse = await fetch(`${apiUrl}/v1/ugc/assets/manifests/${upload.id}`);
if (!persistedResponse.ok) {
  throw new Error(`Leitura do manifesto verificado falhou (${persistedResponse.status}).`);
}
const persisted = Buffer.from(await persistedResponse.arrayBuffer());
if (!persisted.equals(bytes)) throw new Error("Readback HTTP não preservou exatamente os bytes verificados.");

const blueprint = await jsonRequest("/v1/ugc/studio/blueprints", {
  method: "POST",
  headers: { ...authHeaders, "content-type": "application/json" },
  body: JSON.stringify({
    name: `Verified QA ${nonce}`,
    category: "component",
    version: 1,
    assetManifestUri: verified.assetManifestUri,
    contentHash: sha256,
    royaltyBps: 500,
    tokenizationStatus: "disabled",
    verifiedUploadId: upload.id
  })
});
const blueprintId = String(blueprint?.blueprint?.id ?? "");
if (!blueprintId) throw new Error("Criação do blueprint verificado não retornou ID.");
if (blueprint?.integrity?.verifiedUploadId !== upload.id || blueprint?.integrity?.remoteVerification !== true) {
  throw new Error("Blueprint não confirmou vínculo com upload verificado.");
}

const inventory = await jsonRequest("/v1/ugc/studio/blueprints/me?limit=200", {
  headers: authHeaders
});
const item = inventory?.blueprints?.find((candidate) => String(candidate.id) === blueprintId);
if (!item) throw new Error("Blueprint verificado não apareceu no inventário do criador.");
if (String(item.verified_upload_id ?? "") !== upload.id || String(item.verified_upload_status ?? "") !== "verified") {
  throw new Error("Inventário não preservou o vínculo verificado entre blueprint, registry e upload.");
}

const report = {
  status: "passed",
  uploadId: upload.id,
  blueprintId,
  sha256,
  sizeBytes: bytes.length,
  canonicalUri: verified.assetManifestUri,
  storageReadbackExact: true,
  atomicBlueprintBinding: true,
  signature: "Tehkné Solutions"
};
await writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
