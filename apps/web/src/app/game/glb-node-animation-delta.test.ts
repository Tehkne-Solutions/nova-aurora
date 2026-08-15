import assert from "node:assert/strict";
import { test } from "node:test";
import {
  animatedNormalizedDelta,
  computeAnimationNormalization,
  inverse4,
  normalMatrix3,
  transformPoint
} from "./glb-node-animation-delta.js";
import {
  multiply4,
  trsMatrix
} from "./glb-node-animation-runtime.js";
import { parseCertifiedNodeAnimationRuntime } from "./glb-node-animation-sampling.js";

function almost(actual: number, expected: number, tolerance = 1e-5): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function padded(bytes: Buffer, fill = 0x20): Buffer {
  const padding = (4 - bytes.length % 4) % 4;
  return padding === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(padding, fill)]);
}

function fixture(): ArrayBuffer {
  const positions = [-2, -1, 0, 2, -1, 0, 0, 3, 0];
  const times = [0, 1];
  const translations = [1, 0, 0, 3, 0, 0];
  const positionBytes = positions.length * 4;
  const timeOffset = positionBytes;
  const translationOffset = timeOffset + times.length * 4;
  const binary = Buffer.alloc(translationOffset + translations.length * 4);
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  times.forEach((value, index) => binary.writeFloatLE(value, timeOffset + index * 4));
  translations.forEach((value, index) => binary.writeFloatLE(value, translationOffset + index * 4));
  const document = {
    asset: { version: "2.0", generator: "Nova Aurora animation delta test · Tehkné Solutions" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [1, 0, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    animations: [{
      samplers: [{ input: 1, output: 2, interpolation: "LINEAR" }],
      channels: [{ sampler: 0, target: { node: 0, path: "translation" } }]
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 2, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 2, type: "VEC3" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes },
      { buffer: 0, byteOffset: timeOffset, byteLength: times.length * 4 },
      { buffer: 0, byteOffset: translationOffset, byteLength: translations.length * 4 }
    ],
    buffers: [{ byteLength: binary.length }]
  };
  const json = padded(Buffer.from(JSON.stringify(document), "utf8"));
  const bin = padded(binary, 0);
  const length = 12 + 8 + json.length + 8 + bin.length;
  const glb = Buffer.alloc(length);
  glb.write("glTF", 0, "ascii");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  const header = 20 + json.length;
  glb.writeUInt32LE(bin.length, header);
  glb.writeUInt32LE(0x004e4942, header + 4);
  bin.copy(glb, header + 8);
  const copy = new Uint8Array(glb.length);
  copy.set(glb);
  return copy.buffer;
}

test("inverse4 composes affine TRS back to identity", () => {
  const matrix = trsMatrix([3, -2, 5], [0, Math.SQRT1_2, 0, Math.SQRT1_2], [2, 3, 4]);
  const product = multiply4(matrix, inverse4(matrix));
  const expected = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let index = 0; index < 16; index += 1) almost(product[index]!, expected[index]!);
});

test("normalMatrix3 uses inverse transpose under non-uniform scale", () => {
  const matrix = trsMatrix([0, 0, 0], [0, 0, 0, 1], [2, 4, 8]);
  const normal = normalMatrix3(matrix);
  almost(normal[0]!, 0.5);
  almost(normal[4]!, 0.25);
  almost(normal[8]!, 0.125);
});

test("computeAnimationNormalization reproduces static 1.55 extent contract", () => {
  const buffer = fixture();
  const model = parseCertifiedNodeAnimationRuntime(buffer);
  const normalization = computeAnimationNormalization(buffer, model);
  // Base positions after node translation span x=-1..3 and y=-1..3 => extent 4.
  almost(normalization.scale, 1.55 / 4);
  almost(normalization.center[0], 1);
  almost(normalization.center[1], 1);
  almost(normalization.center[2], 0);
  const center = transformPoint(normalization.matrix, normalization.center);
  almost(center[0], 0);
  almost(center[1], 0);
  almost(center[2], 0);
});

test("animated normalized delta moves normalized points by scaled authored translation", () => {
  const buffer = fixture();
  const model = parseCertifiedNodeAnimationRuntime(buffer);
  const normalization = computeAnimationNormalization(buffer, model);
  const baseWorld = model.primitives[0]!.baseWorld;
  const animatedWorld = trsMatrix([3, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
  const delta = animatedNormalizedDelta(baseWorld, animatedWorld, normalization);
  const origin = transformPoint(delta, [0, 0, 0]);
  // +2 authored world units become +2 * normalization.scale in normalized space.
  almost(origin[0], 2 * normalization.scale);
  almost(origin[1], 0);
  almost(origin[2], 0);
});

test("normalization matrix and inverse roundtrip a point", () => {
  const buffer = fixture();
  const model = parseCertifiedNodeAnimationRuntime(buffer);
  const normalization = computeAnimationNormalization(buffer, model);
  const point = [2.25, -4.5, 7] as const;
  const roundtrip = transformPoint(normalization.inverse, transformPoint(normalization.matrix, point));
  almost(roundtrip[0], point[0]);
  almost(roundtrip[1], point[1]);
  almost(roundtrip[2], point[2]);
});

// Tehkné Solutions
