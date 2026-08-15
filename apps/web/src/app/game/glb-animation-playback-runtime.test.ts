import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleResolvedAnimationPlayback } from "./glb-animation-playback-runtime.js";
import type { NodeAnimationRuntimeModel } from "./glb-node-animation-runtime.js";

function model(clips: NodeAnimationRuntimeModel["clips"]): NodeAnimationRuntimeModel {
  return {
    nodes: [{ translation: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }],
    parents: [null],
    primitives: [{ nodeIndex: 0, primitiveIndex: 0, baseWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1] }],
    clips,
    animationModel: "node-trs-linear-step-v1"
  };
}

const clips: NodeAnimationRuntimeModel["clips"] = [
  { name: "Idle", durationSeconds: 2, channels: [] },
  { name: "Open", durationSeconds: 1, channels: [] }
];

test("adapter resolves named clip and applies loop time policy before sampling", () => {
  const frame = sampleResolvedAnimationPlayback(model(clips), "Open", 2.4, true);
  assert.equal(frame.playback.clipIndex, 1);
  assert.equal(frame.playback.resolution, "name");
  assert.ok(Math.abs(frame.timeSeconds - 0.4) < 1e-9);
  assert.deepEqual([frame.worlds[0]?.[12], frame.worlds[0]?.[13], frame.worlds[0]?.[14]], [1, 2, 3]);
});

test("adapter clamps non-loop playback at authored duration", () => {
  const frame = sampleResolvedAnimationPlayback(model(clips), "Idle", 9, false);
  assert.equal(frame.timeSeconds, 2);
  assert.equal(frame.playback.loop, false);
});

test("invalid selector uses deterministic default clip through one adapter", () => {
  const frame = sampleResolvedAnimationPlayback(model(clips), "Missing", 0.5, true);
  assert.equal(frame.playback.clipIndex, 0);
  assert.equal(frame.playback.resolution, "default");
  assert.equal(frame.timeSeconds, 0.5);
});

test("static model returns base pose without requesting an animation clip", () => {
  const frame = sampleResolvedAnimationPlayback(model([]), "Idle", 8, true);
  assert.equal(frame.playback.animated, false);
  assert.equal(frame.playback.clipIndex, -1);
  assert.equal(frame.timeSeconds, 0);
  assert.deepEqual([frame.worlds[0]?.[12], frame.worlds[0]?.[13], frame.worlds[0]?.[14]], [1, 2, 3]);
});

// Tehkné Solutions
