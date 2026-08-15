import assert from "node:assert/strict";
import { test } from "node:test";
import { GlbSecurityError } from "./glb-structural-security.js";
import { validateGlbNodeAnimations } from "./glb-animation-security.js";

function padded(buffer: Buffer, fill = 0x20): Buffer {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(padding, fill)]);
}

function buildGlb(options: Readonly<{
  path?: "translation" | "rotation" | "scale" | "weights";
  interpolation?: string;
  times?: readonly number[];
  values?: readonly number[];
  nodeMatrix?: boolean;
  duplicateChannel?: boolean;
}> = {}): Buffer {
  const path = options.path ?? "translation";
  const interpolation = options.interpolation ?? "LINEAR";
  const times = options.times ?? [0, 1];
  const components = path === "rotation" ? 4 : 3;
  const values = options.values ?? (path === "rotation"
    ? [0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2]
    : [0, 0, 0, 1, 0, 0]);
  const inputBytes = times.length * 4;
  const outputOffset = inputBytes;
  const binary = Buffer.alloc(outputOffset + values.length * 4);
  times.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  values.forEach((value, index) => binary.writeFloatLE(value, outputOffset + index * 4));

  const channels = [{ sampler: 0, target: { node: 0, path } }];
  if (options.duplicateChannel) channels.push({ sampler: 0, target: { node: 0, path } });
  const document = {
    asset: { version: "2.0", generator: "Nova Aurora animation security test · Tehkné Solutions" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [options.nodeMatrix ? { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } : {}],
    animations: [{
      samplers: [{ input: 0, output: 1, interpolation }],
      channels
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: times.length, type: "SCALAR" },
      { bufferView: 1, componentType: 5126, count: values.length / components, type: path === "rotation" ? "VEC4" : "VEC3" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: inputBytes },
      { buffer: 0, byteOffset: outputOffset, byteLength: values.length * 4 }
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
  const binHeader = 20 + json.length;
  glb.writeUInt32LE(bin.length, binHeader);
  glb.writeUInt32LE(0x004e4942, binHeader + 4);
  bin.copy(glb, binHeader + 8);
  return glb;
}

function expectCode(run: () => unknown, code: string): void {
  assert.throws(run, (error: unknown) => error instanceof GlbSecurityError && error.code === code);
}

test("certifies bounded LINEAR translation animation", () => {
  const report = validateGlbNodeAnimations(buildGlb());
  assert.equal(report.version, 1);
  assert.equal(report.animations, 1);
  assert.equal(report.channels, 1);
  assert.equal(report.translationChannels, 1);
  assert.equal(report.rotationChannels, 0);
  assert.equal(report.totalKeyframes, 2);
  assert.equal(report.maxDurationSeconds, 1);
  assert.deepEqual(report.interpolations, ["LINEAR"]);
  assert.equal(report.signature, "Tehkné Solutions");
});

test("certifies STEP normalized quaternion rotation", () => {
  const report = validateGlbNodeAnimations(buildGlb({ path: "rotation", interpolation: "STEP" }));
  assert.equal(report.rotationChannels, 1);
  assert.deepEqual(report.interpolations, ["STEP"]);
});

test("rejects non-increasing animation input time", () => {
  expectCode(() => validateGlbNodeAnimations(buildGlb({ times: [0, 0] })), "animation-time-order");
});

test("rejects animation longer than runtime budget", () => {
  expectCode(() => validateGlbNodeAnimations(buildGlb({ times: [0, 121] })), "animation-duration-limit");
});

test("rejects CUBICSPLINE until dedicated runtime exists", () => {
  expectCode(() => validateGlbNodeAnimations(buildGlb({ interpolation: "CUBICSPLINE" })), "animation-interpolation");
});

test("rejects morph weights in node-animation foundation", () => {
  expectCode(() => validateGlbNodeAnimations(buildGlb({ path: "weights" })), "animation-target-path");
});

test("rejects non-unit quaternion output", () => {
  expectCode(
    () => validateGlbNodeAnimations(buildGlb({ path: "rotation", values: [0, 0, 0, 2, 0, 0, 0, 2] })),
    "animation-quaternion"
  );
});

test("rejects animated nodes authored with matrix", () => {
  expectCode(() => validateGlbNodeAnimations(buildGlb({ nodeMatrix: true })), "animation-node-matrix");
});

test("rejects duplicate channels targeting same node property", () => {
  expectCode(() => validateGlbNodeAnimations(buildGlb({ duplicateChannel: true })), "animation-duplicate-target");
});

// Tehkné Solutions
