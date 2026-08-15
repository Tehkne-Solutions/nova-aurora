import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePbrLiteGlb } from "./glb-pbr-lite-runtime.js";

type JsonObject = Record<string, unknown>;

function padded(bytes: Buffer, fill = 0x20): Buffer {
  const padding = (4 - bytes.length % 4) % 4;
  return padding === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(padding, fill)]);
}

function makeGlb(material: JsonObject): ArrayBuffer {
  const binary = Buffer.alloc(72);
  const positions = [-0.7, -0.55, 0, 0.7, -0.55, 0, 0, 0.75, 0];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  normals.forEach((value, index) => binary.writeFloatLE(value, 36 + index * 4));
  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0, mode: 4 }] }],
    materials: [material],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 }
    ],
    buffers: [{ byteLength: 72 }]
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

test("preserves metallic, roughness and emissive factors", () => {
  const model = parsePbrLiteGlb(makeGlb({
    pbrMetallicRoughness: {
      baseColorFactor: [0.25, 0.5, 0.75, 1],
      metallicFactor: 0.65,
      roughnessFactor: 0.3
    },
    emissiveFactor: [0.1, 0.2, 0.05]
  }));
  const drawable = model.drawables[0];
  assert.ok(drawable);
  assert.equal(drawable.metallic, 0.65);
  assert.equal(drawable.roughness, 0.3);
  assert.deepEqual(drawable.emissive, [0.1, 0.2, 0.05]);
  assert.deepEqual(drawable.color, [0.25, 0.5, 0.75, 1]);
  assert.equal(model.metallicMaterials, 1);
  assert.equal(model.emissiveMaterials, 1);
  assert.equal(model.materialModel, "pbr-lite-factors-v1");
});

test("uses glTF defaults when PBR numeric factors are omitted", () => {
  const model = parsePbrLiteGlb(makeGlb({ pbrMetallicRoughness: { baseColorFactor: [0.4, 0.4, 0.4, 1] } }));
  const drawable = model.drawables[0];
  assert.equal(drawable?.metallic, 1);
  assert.equal(drawable?.roughness, 1);
  assert.deepEqual(drawable?.emissive, [0, 0, 0]);
});

test("rejects texture inputs until the embedded texture security sprint", () => {
  assert.throws(
    () => parsePbrLiteGlb(makeGlb({
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        baseColorTexture: { index: 0 }
      }
    })),
    /baseColorTexture ainda não pertence ao perfil PBR-lite sem texturas/
  );
});

test("rejects numeric factors outside the bounded profile", () => {
  assert.throws(
    () => parsePbrLiteGlb(makeGlb({
      pbrMetallicRoughness: { metallicFactor: 1.2, roughnessFactor: 0.5 }
    })),
    /metallicFactor precisa estar entre 0 e 1/
  );
});

// Tehkné Solutions
