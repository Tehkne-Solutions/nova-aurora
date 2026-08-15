import assert from "node:assert/strict";
import { test } from "node:test";
import {
  animationPlaybackForObjectState,
  normalizeObjectAnimationState,
  sampleObjectAnimationState
} from "./glb-object-animation-state";
import type { NodeAnimationRuntimeModel } from "./glb-node-animation-runtime";

const model: NodeAnimationRuntimeModel = {
  nodes: [{ translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }],
  parents: [null],
  primitives: [{ nodeIndex: 0, primitiveIndex: 0, baseWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
  clips: [
    { name: "Idle", durationSeconds: 2, channels: [] },
    { name: "Open", durationSeconds: 1, channels: [] },
    { name: "Spin", durationSeconds: 4, channels: [] }
  ],
  animationModel: "node-trs-linear-step-v1"
};

test("idle and spin are looping object states", () => {
  assert.deepEqual(animationPlaybackForObjectState("idle"), {
    state: "idle",
    selector: { name: "Idle" },
    loop: true
  });
  assert.deepEqual(animationPlaybackForObjectState("spin"), {
    state: "spin",
    selector: { name: "Spin" },
    loop: true
  });
});

test("open close activate and deactivate are one-shot states", () => {
  for (const state of ["open", "close", "activate", "deactivate"] as const) {
    const policy = animationPlaybackForObjectState(state);
    assert.equal(policy.loop, false);
    assert.equal(policy.state, state);
  }
  assert.deepEqual(animationPlaybackForObjectState("open").selector, { name: "Open" });
  assert.deepEqual(animationPlaybackForObjectState("close").selector, { name: "Close" });
  assert.deepEqual(animationPlaybackForObjectState("activate").selector, { name: "Activate" });
  assert.deepEqual(animationPlaybackForObjectState("deactivate").selector, { name: "Deactivate" });
});

test("external state normalization is case insensitive and fails safe to idle", () => {
  assert.equal(normalizeObjectAnimationState(" OPEN "), "open");
  assert.equal(normalizeObjectAnimationState("Spin"), "spin");
  assert.equal(normalizeObjectAnimationState("unknown"), "idle");
  assert.equal(normalizeObjectAnimationState(null), "idle");
});

test("object state resolves clip loop policy and certified world matrices", () => {
  const idle = sampleObjectAnimationState(model, "idle", 5.25);
  assert.equal(idle.playback.clipName, "Idle");
  assert.equal(idle.playback.loop, true);
  assert.equal(idle.timeSeconds, 1.25);
  assert.equal(idle.worlds.length, 1);

  const open = sampleObjectAnimationState(model, "open", 5.25);
  assert.equal(open.playback.clipName, "Open");
  assert.equal(open.playback.loop, false);
  assert.equal(open.timeSeconds, 1);
  assert.equal(open.worlds.length, 1);
});

// Tehkné Solutions
