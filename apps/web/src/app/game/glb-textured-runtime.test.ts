import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTexturedPbrGlb } from "./glb-textured-runtime.js";

type JsonObject = Record<string, unknown>;

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function padded(bytes: Buffer, fill = 0x20): Buffer {
  const padding = (4 - bytes.length % 4) % 4;
  return padding === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(padding, fill)]);
}

function makeGlb(options: Readonly<{
  textured?: boolean;
  includeTexCoord?: boolean;
  texCoordType?: string;
  extraMaterial?: JsonObject;
}> = {}): ArrayBuffer {
  const textured = options.textured ?? true;
  const includeTexCoord = options.includeTexCoord ?? true;
  const texCoordType = options.texCoordType ?? "VEC2";
  const positions = [-0.7, -0.55, 0, 0.7, -0.55, 0, 0, 0.75, 0];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  const texCoords = [0, 0, 1, 0, 0.5, 1];
  const geometryBytes = 36 + 36 + 24;
  const binary = Buffer.alloc(geometryBytes + PNG_1X1.length);
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  normals.forEach((value, index) => binary.writeFloatLE(value, 36 + index * 4));
  texCoords.forEach((value, index) => binary.writeFloatLE(value, 72 + index * 4));
  PNG_1X1.copy(binary, geometryBytes);

  const material: JsonObject = {
    pbrMetallicRoughness: {
      baseColorFactor: [0.8, 0.7, 0.6, 1],
      metallicFactor: 0.2,
      roughnessFactor: 0.55,
      ...(textured ? { baseColorTexture: { index: 0, texCoord: 0 } } : {})
    },
    emissiveFactor: [0.02, 0.01, 0],
    ...(options.extraMaterial ?? {})
  };
  const attributes: JsonObject = { POSITION: 0, NORMAL: 1 };
  if (includeTexCoord) attributes.TEXCOORD_0 = 2;

  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes, material: 0, mode: 4 }] }],
    materials: [material],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 3, type: texCoordType }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 24 },
      { buffer: 0, byteOffset: geometryBytes, byteLength: PNG_1X1.length }
    ],
    buffers: [{ byteLength: binary.length }],
    ...(textured ? {
      images: [{ bufferView: 3, mimeType: "image/png" }],
      samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }],
      textures: [{ source: 0, sampler: 0 }]
    } : {})
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

test("exposes approved embedded baseColorTexture bytes and TEXCOORD_0", () => {
  const model = parseTexturedPbrGlb(makeGlb());
  const drawable = model.drawables[0];
  assert.ok(drawable);
  assert.equal(model.materialModel, "pbr-lite-basecolor-texture-v1");
  assert.equal(model.texturedMaterials, 1);
  assert.equal(model.embeddedTextureBytes, PNG_1X1.length);
  assert.equal(drawable.baseColorTexture?.mimeType, "image/png");
  assert.equal(drawable.baseColorTexture?.imageIndex, 0);
  assert.equal(drawable.baseColorTexture?.textureIndex, 0);
  assert.equal(drawable.baseColorTexture?.bytes.byteLength, PNG_1X1.length);
  assert.deepEqual(Array.from(drawable.baseColorTexture?.bytes ?? []), Array.from(PNG_1X1));
  assert.deepEqual(Array.from(drawable.texCoords ?? []), [0, 0, 1, 0, 0.5, 1]);
  assert.equal(drawable.metallic, 0.2);
  assert.equal(drawable.roughness, 0.55);
});

test("remains backwards compatible with numeric-only PBR-lite GLB", () => {
  const model = parseTexturedPbrGlb(makeGlb({ textured: false }));
  const drawable = model.drawables[0];
  assert.ok(drawable);
  assert.equal(model.texturedMaterials, 0);
  assert.equal(model.embeddedTextureBytes, 0);
  assert.equal(drawable.baseColorTexture, null);
  assert.equal(drawable.texCoords, null);
  assert.equal(drawable.metallic, 0.2);
  assert.equal(drawable.roughness, 0.55);
});

test("fails closed when a textured primitive has no TEXCOORD_0", () => {
  assert.throws(
    () => parseTexturedPbrGlb(makeGlb({ includeTexCoord: false })),
    /usa baseColorTexture sem TEXCOORD_0/
  );
});

test("fails closed when TEXCOORD_0 is not FLOAT VEC2", () => {
  assert.throws(
    () => parseTexturedPbrGlb(makeGlb({ texCoordType: "VEC3" })),
    /TEXCOORD_0 precisa ser FLOAT VEC2/
  );
});

test("keeps non-baseColor texture slots outside the 23.11 profile", () => {
  assert.throws(
    () => parseTexturedPbrGlb(makeGlb({ extraMaterial: { normalTexture: { index: 0 } } })),
    /normalTexture ainda não pertence ao perfil 23.11/
  );
});

// Tehkné Solutions
