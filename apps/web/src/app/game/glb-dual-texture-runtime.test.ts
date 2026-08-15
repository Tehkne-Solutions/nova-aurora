import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDualTexturePbrGlb } from "./glb-dual-texture-runtime.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function padded(bytes: Buffer, fill = 0x20): Buffer {
  const padding = (4 - bytes.length % 4) % 4;
  return padding === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(padding, fill)]);
}

function makeGlb(options: Readonly<{
  baseColorTexture?: boolean;
  metallicRoughnessTexture?: boolean;
  mrTexCoord?: number;
  externalMrImage?: boolean;
}> = {}): ArrayBuffer {
  const baseColorTexture = options.baseColorTexture ?? true;
  const metallicRoughnessTexture = options.metallicRoughnessTexture ?? true;
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

  const pbr: Record<string, unknown> = {
    baseColorFactor: [0.8, 0.7, 0.6, 1],
    metallicFactor: 0.4,
    roughnessFactor: 0.6
  };
  if (baseColorTexture) pbr.baseColorTexture = { index: 0, texCoord: 0 };
  if (metallicRoughnessTexture) pbr.metallicRoughnessTexture = { index: 1, texCoord: options.mrTexCoord ?? 0 };

  const images = [
    { bufferView: 3, mimeType: "image/png" },
    options.externalMrImage ? { uri: "https://invalid.example/mr.png", mimeType: "image/png" } : { bufferView: 4, mimeType: "image/png" }
  ];

  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, material: 0, mode: 4 }] }],
    materials: [{ pbrMetallicRoughness: pbr, emissiveFactor: [0.02, 0.01, 0] }],
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
    samplers: [
      { magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 },
      { magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 }
    ],
    textures: [{ source: 0, sampler: 0 }, { source: 1, sampler: 1 }]
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

test("preserves base color and metallic-roughness embedded textures on one primitive", () => {
  const model = parseDualTexturePbrGlb(makeGlb());
  const drawable = model.drawables[0];
  assert.ok(drawable);
  assert.equal(model.materialModel, "pbr-lite-dual-texture-v2");
  assert.equal(model.baseColorTexturedMaterials, 1);
  assert.equal(model.metallicRoughnessTexturedMaterials, 1);
  assert.equal(model.uniqueEmbeddedTextures, 2);
  assert.equal(model.embeddedTextureBytes, PNG_1X1.length * 2);
  assert.equal(drawable.baseColorTexture?.textureIndex, 0);
  assert.equal(drawable.metallicRoughnessTexture?.textureIndex, 1);
  assert.equal(drawable.metallicRoughnessTexture?.sampler.magFilter, 9728);
  assert.equal(drawable.metallic, 0.4);
  assert.equal(drawable.roughness, 0.6);
  assert.deepEqual(Array.from(drawable.texCoords ?? []), [0, 0, 1, 0, 0.5, 1]);
});

test("supports metallic-roughness texture when base color texture is absent", () => {
  const model = parseDualTexturePbrGlb(makeGlb({ baseColorTexture: false }));
  const drawable = model.drawables[0];
  assert.ok(drawable);
  assert.equal(model.baseColorTexturedMaterials, 0);
  assert.equal(model.metallicRoughnessTexturedMaterials, 1);
  assert.equal(drawable.baseColorTexture, null);
  assert.ok(drawable.metallicRoughnessTexture);
  assert.deepEqual(Array.from(drawable.texCoords ?? []), [0, 0, 1, 0, 0.5, 1]);
});

test("remains compatible when metallic-roughness texture is absent", () => {
  const model = parseDualTexturePbrGlb(makeGlb({ metallicRoughnessTexture: false }));
  const drawable = model.drawables[0];
  assert.equal(model.metallicRoughnessTexturedMaterials, 0);
  assert.equal(drawable?.metallicRoughnessTexture, null);
  assert.ok(drawable?.baseColorTexture);
});

test("fails closed for nonzero metallic-roughness texCoord", () => {
  assert.throws(
    () => parseDualTexturePbrGlb(makeGlb({ mrTexCoord: 1 })),
    /metallicRoughnessTexture.texCoord precisa ser 0/
  );
});

test("fails closed for external metallic-roughness image URI", () => {
  assert.throws(
    () => parseDualTexturePbrGlb(makeGlb({ externalMrImage: true })),
    /Texture externa\/data URI é proibida/
  );
});

// Tehkné Solutions
