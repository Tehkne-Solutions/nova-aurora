import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAmbientEmissivePbrGlb } from "./glb-ambient-emissive-runtime.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function padded(bytes: Buffer, fill = 0x20): Buffer {
  const padding = (4 - bytes.length % 4) % 4;
  return padding === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(padding, fill)]);
}

function makeGlb(options: Readonly<{
  occlusion?: boolean;
  emissive?: boolean;
  occlusionTexCoord?: number;
  occlusionStrength?: number;
  externalEmissive?: boolean;
  normalTexture?: boolean;
}> = {}): ArrayBuffer {
  const occlusion = options.occlusion ?? true;
  const emissive = options.emissive ?? true;
  const positions = [-0.7, -0.55, 0, 0.7, -0.55, 0, 0, 0.75, 0];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  const texCoords = [0, 0, 1, 0, 0.5, 1];
  const geometryBytes = 96;
  const image0Offset = geometryBytes;
  const image1Offset = image0Offset + PNG_1X1.length;
  const binary = Buffer.alloc(geometryBytes + PNG_1X1.length * 2);
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  normals.forEach((value, index) => binary.writeFloatLE(value, 36 + index * 4));
  texCoords.forEach((value, index) => binary.writeFloatLE(value, 72 + index * 4));
  PNG_1X1.copy(binary, image0Offset);
  PNG_1X1.copy(binary, image1Offset);

  const material: Record<string, unknown> = {
    pbrMetallicRoughness: {
      baseColorFactor: [0.65, 0.72, 0.8, 1],
      metallicFactor: 0.15,
      roughnessFactor: 0.7
    },
    emissiveFactor: [0.4, 0.2, 0.1]
  };
  if (occlusion) {
    material.occlusionTexture = {
      index: 0,
      texCoord: options.occlusionTexCoord ?? 0,
      strength: options.occlusionStrength ?? 0.65
    };
  }
  if (emissive) material.emissiveTexture = { index: 1, texCoord: 0 };
  if (options.normalTexture) material.normalTexture = { index: 0, texCoord: 0, scale: 1 };

  const images = [
    { bufferView: 3, mimeType: "image/png" },
    options.externalEmissive
      ? { uri: "https://invalid.example/emissive.png", mimeType: "image/png" }
      : { bufferView: 4, mimeType: "image/png" }
  ];

  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, material: 0, mode: 4 }] }],
    materials: [material],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC2" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 24 },
      { buffer: 0, byteOffset: image0Offset, byteLength: PNG_1X1.length },
      { buffer: 0, byteOffset: image1Offset, byteLength: PNG_1X1.length }
    ],
    buffers: [{ byteLength: binary.length }],
    images,
    samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }],
    textures: [{ source: 0, sampler: 0 }, { source: 1, sampler: 0 }]
  };

  const json = padded(Buffer.from(JSON.stringify(document), "utf8"));
  const bin = padded(binary, 0);
  const length = 12 + 8 + json.length + 8 + bin.length;
  const output = Buffer.alloc(length);
  output.write("glTF", 0, "ascii");
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(length, 8);
  output.writeUInt32LE(json.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  json.copy(output, 20);
  const offset = 20 + json.length;
  output.writeUInt32LE(bin.length, offset);
  output.writeUInt32LE(0x004e4942, offset + 4);
  bin.copy(output, offset + 8);
  const copy = new Uint8Array(output.length);
  copy.set(output);
  return copy.buffer;
}

test("exposes embedded occlusion and emissive textures with authored strength", () => {
  const model = parseAmbientEmissivePbrGlb(makeGlb());
  const drawable = model.drawables[0];
  assert.ok(drawable);
  assert.equal(model.materialModel, "pbr-lite-ambient-emissive-v3");
  assert.equal(model.occlusionTexturedMaterials, 1);
  assert.equal(model.emissiveTexturedMaterials, 1);
  assert.equal(model.uniqueEmbeddedTextures, 2);
  assert.equal(model.embeddedTextureBytes, PNG_1X1.length * 2);
  assert.equal(drawable.occlusionTexture?.textureIndex, 0);
  assert.equal(drawable.occlusionStrength, 0.65);
  assert.equal(drawable.emissiveTexture?.textureIndex, 1);
  assert.deepEqual(Array.from(drawable.texCoords ?? []), [0, 0, 1, 0, 0.5, 1]);
  assert.deepEqual(drawable.emissive, [0.4, 0.2, 0.1]);
});

test("remains compatible when ambient effect textures are absent", () => {
  const model = parseAmbientEmissivePbrGlb(makeGlb({ occlusion: false, emissive: false }));
  const drawable = model.drawables[0];
  assert.equal(model.occlusionTexturedMaterials, 0);
  assert.equal(model.emissiveTexturedMaterials, 0);
  assert.equal(drawable?.occlusionTexture, null);
  assert.equal(drawable?.emissiveTexture, null);
  assert.equal(drawable?.occlusionStrength, 1);
});

test("fails closed for nonzero occlusion texCoord", () => {
  assert.throws(
    () => parseAmbientEmissivePbrGlb(makeGlb({ occlusionTexCoord: 1 })),
    /occlusionTexture.texCoord precisa ser 0/
  );
});

test("fails closed for occlusion strength outside glTF range", () => {
  assert.throws(
    () => parseAmbientEmissivePbrGlb(makeGlb({ occlusionStrength: 1.5 })),
    /occlusionTexture.strength precisa estar entre 0 e 1/
  );
});

test("fails closed for external emissive texture URI", () => {
  assert.throws(
    () => parseAmbientEmissivePbrGlb(makeGlb({ externalEmissive: true })),
    /Texture externa\/data URI é proibida/
  );
});

test("keeps normalTexture outside the 23.13 profile", () => {
  assert.throws(
    () => parseAmbientEmissivePbrGlb(makeGlb({ normalTexture: true })),
    /normalTexture ainda não pertence ao perfil 23.11/
  );
});

// Tehkné Solutions
