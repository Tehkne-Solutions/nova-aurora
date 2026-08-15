import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAlphaMaskPbrGlb } from "./glb-alpha-mask-runtime.js";

type JsonObject = Record<string, unknown>;

function padded(bytes: Buffer, fill = 0x20): Buffer {
  const padding = (4 - bytes.length % 4) % 4;
  return padding === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(padding, fill)]);
}

function makeGlb(options: Readonly<{
  alphaMode?: string;
  alphaCutoff?: number;
  baseAlpha?: number;
  omitAlphaMode?: boolean;
}> = {}): ArrayBuffer {
  const positions = [-0.7, -0.55, 0, 0.7, -0.55, 0, 0, 0.75, 0];
  const binary = Buffer.alloc(36);
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  const material: JsonObject = {
    pbrMetallicRoughness: {
      baseColorFactor: [0.4, 0.7, 0.5, options.baseAlpha ?? 1],
      metallicFactor: 0.1,
      roughnessFactor: 0.8
    }
  };
  if (!options.omitAlphaMode) material.alphaMode = options.alphaMode ?? "MASK";
  if (options.alphaCutoff !== undefined) material.alphaCutoff = options.alphaCutoff;

  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 4 }] }],
    materials: [material],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: binary.length }]
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

test("parses MASK with authored alphaCutoff and preserves base alpha factor", () => {
  const model = parseAlphaMaskPbrGlb(makeGlb({ alphaMode: "MASK", alphaCutoff: 0.37, baseAlpha: 0.62 }));
  const drawable = model.drawables[0];
  assert.ok(drawable);
  assert.equal(model.materialModel, "pbr-alpha-mask-v1");
  assert.equal(model.alphaMaskedMaterials, 1);
  assert.equal(model.opaqueMaterials, 0);
  assert.equal(drawable.alphaMode, "MASK");
  assert.equal(drawable.alphaCutoff, 0.37);
  assert.equal(drawable.color[3], 0.62);
});

test("uses glTF default alphaCutoff 0.5 for MASK", () => {
  const model = parseAlphaMaskPbrGlb(makeGlb({ alphaMode: "MASK" }));
  assert.equal(model.drawables[0]?.alphaCutoff, 0.5);
  assert.equal(model.alphaMaskedMaterials, 1);
});

test("treats omitted alphaMode as OPAQUE", () => {
  const model = parseAlphaMaskPbrGlb(makeGlb({ omitAlphaMode: true, baseAlpha: 0.2 }));
  const drawable = model.drawables[0];
  assert.equal(drawable?.alphaMode, "OPAQUE");
  assert.equal(model.opaqueMaterials, 1);
  assert.equal(drawable?.color[3], 0.2);
});

test("accepts alphaCutoff greater than one for a fully discarded MASK profile", () => {
  const model = parseAlphaMaskPbrGlb(makeGlb({ alphaMode: "MASK", alphaCutoff: 1.25 }));
  assert.equal(model.drawables[0]?.alphaCutoff, 1.25);
});

test("fails closed for negative alphaCutoff", () => {
  assert.throws(
    () => parseAlphaMaskPbrGlb(makeGlb({ alphaMode: "MASK", alphaCutoff: -0.01 })),
    /alphaCutoff precisa ser finito e >= 0/
  );
});

test("keeps BLEND outside the 23.15 profile", () => {
  assert.throws(
    () => parseAlphaMaskPbrGlb(makeGlb({ alphaMode: "BLEND" })),
    /alphaMode=BLEND ainda não pertence ao perfil 23.15/
  );
});

// Tehkné Solutions
