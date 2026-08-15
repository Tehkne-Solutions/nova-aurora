import assert from "node:assert/strict";
import { test } from "node:test";
import { alphaBlendDepth, parseAlphaBlendPbrGlb } from "./glb-alpha-blend-runtime.js";

type JsonObject = Record<string, unknown>;

function padded(bytes: Buffer, fill = 0x20): Buffer {
  const padding = (4 - bytes.length % 4) % 4;
  return padding === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(padding, fill)]);
}

function makeGlb(options: Readonly<{
  modes?: readonly string[];
  maskCutoff?: number;
  blendAlpha?: number;
  blendCutoff?: number;
}> = {}): ArrayBuffer {
  const modes = options.modes ?? ["OPAQUE", "MASK", "BLEND"];
  const centers = [-2, 0, 3];
  const positions: number[] = [];
  for (let primitive = 0; primitive < modes.length; primitive += 1) {
    const z = centers[primitive] ?? primitive * 2;
    positions.push(-0.5, -0.5, z, 0.5, -0.5, z, 0, 0.5, z);
  }
  const binary = Buffer.alloc(positions.length * 4);
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4));

  const accessors = modes.map((_, primitive) => ({
    bufferView: primitive,
    componentType: 5126,
    count: 3,
    type: "VEC3"
  }));
  const bufferViews = modes.map((_, primitive) => ({
    buffer: 0,
    byteOffset: primitive * 36,
    byteLength: 36
  }));
  const materials = modes.map((mode, index): JsonObject => {
    const material: JsonObject = {
      alphaMode: mode,
      pbrMetallicRoughness: {
        baseColorFactor: [0.4 + index * 0.1, 0.7, 0.5, mode === "BLEND" ? options.blendAlpha ?? 0.35 : 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.8
      }
    };
    if (mode === "MASK") material.alphaCutoff = options.maskCutoff ?? 0.42;
    if (mode === "BLEND" && options.blendCutoff !== undefined) material.alphaCutoff = options.blendCutoff;
    return material;
  });

  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: modes.map((_, primitive) => ({
        attributes: { POSITION: primitive },
        material: primitive,
        mode: 4
      }))
    }],
    materials,
    accessors,
    bufferViews,
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

test("parses OPAQUE, MASK and BLEND into distinct material queues", () => {
  const model = parseAlphaBlendPbrGlb(makeGlb());
  assert.equal(model.materialModel, "pbr-alpha-blend-v1");
  assert.equal(model.opaqueMaterials, 1);
  assert.equal(model.alphaMaskedMaterials, 1);
  assert.equal(model.alphaBlendedMaterials, 1);
  assert.deepEqual(model.drawables.map((drawable) => drawable.alphaMode), ["OPAQUE", "MASK", "BLEND"]);
  assert.equal(model.drawables[1]?.alphaCutoff, 0.42);
  assert.equal(model.drawables[2]?.color[3], 0.35);
});

test("BLEND ignores alphaCutoff because cutoff only applies to MASK", () => {
  const model = parseAlphaBlendPbrGlb(makeGlb({ modes: ["BLEND"], blendCutoff: -99, blendAlpha: 0.27 }));
  const drawable = model.drawables[0];
  assert.equal(drawable?.alphaMode, "BLEND");
  assert.equal(drawable?.alphaCutoff, 0.5);
  assert.equal(drawable?.color[3], 0.27);
});

test("MASK keeps authored fixture alphaCutoff when optional override is absent", () => {
  const model = parseAlphaBlendPbrGlb(makeGlb({ modes: ["MASK"] }));
  assert.equal(model.drawables[0]?.alphaMode, "MASK");
  assert.equal(model.drawables[0]?.alphaCutoff, 0.42);
});

test("fails closed for unknown alpha mode", () => {
  assert.throws(
    () => parseAlphaBlendPbrGlb(makeGlb({ modes: ["TRANSMIT"] })),
    /alphaMode inválido: TRANSMIT/
  );
});

test("alphaBlendDepth ranks farther primitive before nearer primitive", () => {
  const camera = [2.45, 1.65, 3.2] as const;
  const far = { centroid: [0, 0, -4] as const };
  const near = { centroid: [0, 0, 2.5] as const };
  assert.ok(alphaBlendDepth(far, 0, camera) > alphaBlendDepth(near, 0, camera));
});

test("alphaBlendDepth accounts for placement rotation around Y", () => {
  const camera = [0, 0, 4] as const;
  const drawable = { centroid: [3, 0, 0] as const };
  const unrotated = alphaBlendDepth(drawable, 0, camera);
  const rotated = alphaBlendDepth(drawable, 90, camera);
  assert.notEqual(unrotated, rotated);
  assert.ok(rotated > unrotated);
});

// Tehkné Solutions
