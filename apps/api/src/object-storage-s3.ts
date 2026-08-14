import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

export type ObjectStorageConfig = Readonly<{
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
}>;

function secretValue(name: string): string {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const file = process.env[`${name}_FILE`]?.trim();
  if (!file) return "";
  return readFileSync(file, "utf8").trim();
}

export function objectStorageEnabled(): boolean {
  return process.env.OBJECT_STORAGE_ENABLED === "true";
}

export function objectStorageConfig(): ObjectStorageConfig {
  const endpoint = (process.env.OBJECT_STORAGE_ENDPOINT ?? "").trim().replace(/\/$/, "");
  const bucket = (process.env.OBJECT_STORAGE_BUCKET ?? "").trim();
  const region = (process.env.OBJECT_STORAGE_REGION ?? "us-east-1").trim();
  const accessKey = secretValue("OBJECT_STORAGE_ACCESS_KEY");
  const secretKey = secretValue("OBJECT_STORAGE_SECRET_KEY");
  if (!endpoint || !bucket || !region || !accessKey || !secretKey) {
    throw new Error("Object storage habilitado sem endpoint, bucket, região ou credenciais completas.");
  }
  return { endpoint, bucket, region, accessKey, secretKey };
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function amzTimestamp(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function canonicalObjectPath(bucket: string, key: string): string {
  const encodedBucket = encodeURIComponent(bucket);
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/${encodedBucket}/${encodedKey}`;
}

function authorizationHeaders(input: {
  method: "PUT" | "GET" | "DELETE";
  url: URL;
  body: Buffer;
  config: ObjectStorageConfig;
  now?: Date;
}): Record<string, string> {
  const now = input.now ?? new Date();
  const { amzDate, dateStamp } = amzTimestamp(now);
  const payloadHash = sha256(input.body);
  const canonicalHeaders = [
    `host:${input.url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`
  ].join("\n") + "\n";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    input.method,
    input.url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${dateStamp}/${input.config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join("\n");
  const kDate = hmac(`AWS4${input.config.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, input.config.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.config.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };
}

async function objectRequest(input: {
  method: "PUT" | "GET" | "DELETE";
  key: string;
  body?: Buffer;
  contentType?: string;
}): Promise<Response> {
  const config = objectStorageConfig();
  const path = canonicalObjectPath(config.bucket, input.key);
  const url = new URL(`${config.endpoint}${path}`);
  const body = input.body ?? Buffer.alloc(0);
  const headers = authorizationHeaders({ method: input.method, url, body, config });
  const init: RequestInit = {
    method: input.method,
    headers: {
      ...headers,
      ...(input.contentType ? { "content-type": input.contentType } : {})
    }
  };
  if (input.method === "PUT") {
    init.body = Uint8Array.from(body).buffer;
  }
  return fetch(url, init);
}

async function storageError(response: Response, action: string): Promise<Error> {
  const detail = (await response.text()).trim().slice(0, 1000);
  return new Error(`${action} falhou no object storage (${response.status})${detail ? `: ${detail}` : "."}`);
}

export async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const response = await objectRequest({ method: "PUT", key, body: bytes, contentType });
  if (!response.ok) throw await storageError(response, "Gravação");
}

export async function getObject(key: string): Promise<Buffer> {
  const response = await objectRequest({ method: "GET", key });
  if (!response.ok) throw await storageError(response, "Leitura");
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const response = await objectRequest({ method: "DELETE", key });
  if (!response.ok && response.status !== 404) throw await storageError(response, "Exclusão");
}

export function objectStorageHealth(): Readonly<{ enabled: boolean; bucket: string | null }> {
  if (!objectStorageEnabled()) return { enabled: false, bucket: null };
  const config = objectStorageConfig();
  return { enabled: true, bucket: config.bucket };
}

// Tehkné Solutions
