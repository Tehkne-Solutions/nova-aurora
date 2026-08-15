import assert from "node:assert/strict";
import { test } from "node:test";
import { GlbSecurityError } from "./glb-structural-security.js";
import {
  GLB_TEXTURE_SECURITY_LIMITS,
  validateGlbEmbeddedTextures
} from "./glb-embedded-texture-security.js";

type JsonObject = Record<string, unknown>;

function padded(bytes: Buffer, fill = 0): Buffer {
  const padding = (4 - bytes.length % 4) % 4;
  return padding === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(padding, fill)]);
}

function makeGlb(document: JsonObject, binary: Buffer): Buffer {
  const json = padded(Buffer.from(JSON.stringify(document), "utf8"), 0x20);
  const bin = padded(binary, 0);
  const length = 12 + 8 + json.length + 8 + bin.length;
  const output = Buffer.alloc(length);
  output.write("glTF", 0, "ascii");
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(length, 8);
  output.writeUInt32LE(json.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  json.copy(output, 20);
  const binOffset = 20 + json.length;
  output.writeUInt32LE(bin.length, binOffset);
  output.writeUInt32LE(0x004e4942, binOffset + 4);
  bin.copy(output, binOffset + 8);
  return output;
}

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpegHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(23);
  let offset = 0;
  bytes[offset++] = 0xff; bytes[offset++] = 0xd8;
  bytes[offset++] = 0xff; bytes[offset++] = 0xe0;
  bytes.writeUInt16BE(4, offset); offset += 2;
  bytes[offset++] = 0; bytes[offset++] = 0;
  bytes[offset++] = 0xff; bytes[offset++] = 0xc0;
  bytes.writeUInt16BE(11, offset); offset += 2;
  bytes[offset++] = 8;
  bytes.writeUInt16BE(height, offset); offset += 2;
  bytes.writeUInt16BE(width, offset); offset += 2;
  bytes[offset++] = 1;
  bytes[offset++] = 1; bytes[offset++] = 0x11; bytes[offset++] = 0;
  bytes[offset++] = 0xff; bytes[offset++] = 0xd9;
  return bytes;
}

function webpVp8xHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  bytes[24] = widthMinusOne & 0xff;
  bytes[25] = widthMinusOne >> 8 & 0xff;
  bytes[26] = widthMinusOne >> 16 & 0xff;
  bytes[27] = heightMinusOne & 0xff;
  bytes[28] = heightMinusOne >> 8 & 0xff;
  bytes[29] = heightMinusOne >> 16 & 0xff;
  return bytes;
}

function documentForImage(imageBytes: Buffer, mimeType: string, overrides: JsonObject = {}): JsonObject {
  return {
    asset: { version: "2.0" },
    buffers: [{ byteLength: padded(imageBytes).length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: imageBytes.length }],
    images: [{ bufferView: 0, mimeType }],
    textures: [{ source: 0 }],
    samplers: [],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 0 } } }],
    ...overrides
  };
}

function expectCode(code: string, run: () => unknown): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof GlbSecurityError);
    assert.equal(error.code, code);
    return true;
  });
}

test("accepts embedded PNG and reports encoded/decoded budgets", () => {
  const png = pngHeader(64, 32);
  const report = validateGlbEmbeddedTextures(makeGlb(documentForImage(png, "image/png"), png));
  assert.equal(report.images, 1);
  assert.equal(report.textures, 1);
  assert.equal(report.referencedImages, 1);
  assert.equal(report.totalEncodedBytes, 24);
  assert.equal(report.totalDecodedPixels, 2048);
  assert.equal(report.maxWidth, 64);
  assert.equal(report.maxHeight, 32);
  assert.deepEqual(report.formats, ["image/png"]);
  assert.equal(report.externalResources, 0);
});

test("reads embedded JPEG SOF dimensions", () => {
  const jpeg = jpegHeader(320, 180);
  const report = validateGlbEmbeddedTextures(makeGlb(documentForImage(jpeg, "image/jpeg"), jpeg));
  assert.equal(report.imageDetails[0]?.width, 320);
  assert.equal(report.imageDetails[0]?.height, 180);
});

test("reads embedded WebP VP8X dimensions", () => {
  const webp = webpVp8xHeader(512, 256);
  const report = validateGlbEmbeddedTextures(makeGlb(documentForImage(webp, "image/webp"), webp));
  assert.equal(report.imageDetails[0]?.width, 512);
  assert.equal(report.imageDetails[0]?.height, 256);
});

test("rejects MIME/signature mismatch", () => {
  const fake = Buffer.alloc(24, 0);
  expectCode(
    "texture-image-signature",
    () => validateGlbEmbeddedTextures(makeGlb(documentForImage(fake, "image/png"), fake))
  );
});

test("rejects dimension bombs before decoding", () => {
  const bomb = pngHeader(GLB_TEXTURE_SECURITY_LIMITS.maxDimension + 1, 1);
  expectCode(
    "texture-dimension-limit",
    () => validateGlbEmbeddedTextures(makeGlb(documentForImage(bomb, "image/png"), bomb))
  );
});

test("rejects image bufferView references outside the document", () => {
  const png = pngHeader(1, 1);
  const document = documentForImage(png, "image/png", {
    images: [{ bufferView: 3, mimeType: "image/png" }]
  });
  expectCode(
    "texture-reference-out-of-range",
    () => validateGlbEmbeddedTextures(makeGlb(document, png))
  );
});

test("rejects material texture references outside the texture table", () => {
  const png = pngHeader(1, 1);
  const document = documentForImage(png, "image/png", {
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 9 } } }]
  });
  expectCode(
    "texture-reference-out-of-range",
    () => validateGlbEmbeddedTextures(makeGlb(document, png))
  );
});

test("rejects nonzero texCoord until UV set expansion is implemented", () => {
  const png = pngHeader(1, 1);
  const document = documentForImage(png, "image/png", {
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 1 } } }]
  });
  expectCode(
    "texture-texcoord",
    () => validateGlbEmbeddedTextures(makeGlb(document, png))
  );
});

// Tehkné Solutions
