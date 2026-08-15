import assert from "node:assert/strict";
import { test } from "node:test";
import { slerpQuat, trsMatrix } from "./glb-node-animation-runtime.js";
import {
  parseCertifiedNodeAnimationRuntime,
  sampleCertifiedNodeWorldMatrices
} from "./glb-node-animation-sampling.js";

type Path = "translation" | "rotation" | "scale";

type ChannelSpec = Readonly<{
  node: number;
  path: Path;
  interpolation?: "LINEAR" | "STEP";
  times: readonly number[];
  values: readonly number[];
}>;

function padded(bytes: Buffer, fill = 0x20): Buffer {
  const padding = (4 - bytes.length % 4) % 4;
  return padding === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(padding, fill)]);
}

function buildAnimatedGlb(options: Readonly<{
  nodes?: readonly Record<string, unknown>[];
  sceneRoots?: readonly number[];
  channels: readonly ChannelSpec[];
}>): ArrayBuffer {
  const nodes = options.nodes ?? [{ mesh: 0 }];
  const binaryParts: Buffer[] = [];
  const accessors: Record<string, unknown>[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  let offset = 0;

  const pushFloatAccessor = (values: readonly number[], type: "SCALAR" | "VEC3" | "VEC4"): number => {
    const components = type === "SCALAR" ? 1 : type === "VEC3" ? 3 : 4;
    assert.equal(values.length % components, 0);
    const buffer = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
    binaryParts.push(buffer);
    const viewIndex = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buffer.length });
    const accessorIndex = accessors.length;
    accessors.push({ bufferView: viewIndex, componentType: 5126, count: values.length / components, type });
    offset += buffer.length;
    return accessorIndex;
  };

  const samplers: Record<string, unknown>[] = [];
  const channels: Record<string, unknown>[] = [];
  for (const channel of options.channels) {
    const input = pushFloatAccessor(channel.times, "SCALAR");
    const output = pushFloatAccessor(channel.values, channel.path === "rotation" ? "VEC4" : "VEC3");
    const samplerIndex = samplers.length;
    samplers.push({ input, output, interpolation: channel.interpolation ?? "LINEAR" });
    channels.push({ sampler: samplerIndex, target: { node: channel.node, path: channel.path } });
  }

  const binary = Buffer.concat(binaryParts);
  const document = {
    asset: { version: "2.0", generator: "Nova Aurora node animation runtime test · Tehkné Solutions" },
    scene: 0,
    scenes: [{ nodes: options.sceneRoots ?? [0] }],
    nodes,
    meshes: [{ primitives: [{ attributes: {} }] }],
    animations: [{ name: "Test Clip", samplers, channels }],
    accessors,
    bufferViews,
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
  const binHeader = 20 + json.length;
  glb.writeUInt32LE(bin.length, binHeader);
  glb.writeUInt32LE(0x004e4942, binHeader + 4);
  bin.copy(glb, binHeader + 8);
  const copy = new Uint8Array(glb.length);
  copy.set(glb);
  return copy.buffer;
}

function translationOf(matrix: readonly number[]): readonly [number, number, number] {
  return [matrix[12]!, matrix[13]!, matrix[14]!];
}

function almostEqual(actual: number, expected: number, tolerance = 1e-5): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("LINEAR translation samples halfway and loops", () => {
  const model = parseCertifiedNodeAnimationRuntime(buildAnimatedGlb({
    channels: [{ node: 0, path: "translation", times: [0, 2], values: [0, 0, 0, 4, 0, 0] }]
  }));
  assert.equal(model.animationModel, "node-trs-linear-step-v1");
  assert.equal(model.clips[0]?.durationSeconds, 2);
  assert.deepEqual(translationOf(sampleCertifiedNodeWorldMatrices(model, 0, 1)[0]!), [2, 0, 0]);
  assert.deepEqual(translationOf(sampleCertifiedNodeWorldMatrices(model, 0, 3)[0]!), [2, 0, 0]);
});

test("STEP switches exactly at an authored middle keyframe", () => {
  const model = parseCertifiedNodeAnimationRuntime(buildAnimatedGlb({
    channels: [{
      node: 0,
      path: "translation",
      interpolation: "STEP",
      times: [0, 1, 2],
      values: [0, 0, 0, 3, 0, 0, 7, 0, 0]
    }]
  }));
  assert.deepEqual(translationOf(sampleCertifiedNodeWorldMatrices(model, 0, 0.999, false)[0]!), [0, 0, 0]);
  assert.deepEqual(translationOf(sampleCertifiedNodeWorldMatrices(model, 0, 1, false)[0]!), [3, 0, 0]);
  assert.deepEqual(translationOf(sampleCertifiedNodeWorldMatrices(model, 0, 1.5, false)[0]!), [3, 0, 0]);
});

test("parent animation propagates through child hierarchy", () => {
  const model = parseCertifiedNodeAnimationRuntime(buildAnimatedGlb({
    nodes: [
      { children: [1], translation: [1, 0, 0] },
      { mesh: 0, translation: [0, 2, 0] }
    ],
    sceneRoots: [0],
    channels: [{ node: 0, path: "translation", times: [0, 1], values: [1, 0, 0, 5, 0, 0] }]
  }));
  const worlds = sampleCertifiedNodeWorldMatrices(model, 0, 1, false);
  assert.deepEqual(translationOf(worlds[0]!), [5, 0, 0]);
  assert.deepEqual(translationOf(worlds[1]!), [5, 2, 0]);
  assert.equal(model.primitives.length, 1);
  assert.equal(model.primitives[0]?.nodeIndex, 1);
});

test("LINEAR scale changes matrix basis without changing translation", () => {
  const model = parseCertifiedNodeAnimationRuntime(buildAnimatedGlb({
    nodes: [{ mesh: 0, translation: [2, 3, 4] }],
    channels: [{ node: 0, path: "scale", times: [0, 1], values: [1, 1, 1, 2, 3, 4] }]
  }));
  const matrix = sampleCertifiedNodeWorldMatrices(model, 0, 1, false)[0]!;
  almostEqual(matrix[0]!, 2);
  almostEqual(matrix[5]!, 3);
  almostEqual(matrix[10]!, 4);
  assert.deepEqual(translationOf(matrix), [2, 3, 4]);
});

test("quaternion slerp follows shortest equivalent-sign path", () => {
  const halfway = slerpQuat([0, 0, 0, 1], [0, 0, 0, -1], 0.5);
  almostEqual(halfway[0], 0);
  almostEqual(halfway[1], 0);
  almostEqual(halfway[2], 0);
  almostEqual(Math.abs(halfway[3]), 1);
});

test("rotation channel interpolates a 90 degree Y turn at halfway", () => {
  const s = Math.SQRT1_2;
  const model = parseCertifiedNodeAnimationRuntime(buildAnimatedGlb({
    channels: [{ node: 0, path: "rotation", times: [0, 2], values: [0, 0, 0, 1, 0, 1, 0, 0] }]
  }));
  const matrix = sampleCertifiedNodeWorldMatrices(model, 0, 1, false)[0]!;
  const expected = trsMatrix([0, 0, 0], [0, s, 0, s], [1, 1, 1]);
  for (let index = 0; index < 16; index += 1) almostEqual(matrix[index]!, expected[index]!, 1e-4);
});

test("certified parse rejects animation channel targeting a missing node", () => {
  assert.throws(
    () => parseCertifiedNodeAnimationRuntime(buildAnimatedGlb({
      channels: [{ node: 4, path: "translation", times: [0, 1], values: [0, 0, 0, 1, 0, 0] }]
    })),
    /referencia node 4 inexistente/
  );
});

// Tehkné Solutions
