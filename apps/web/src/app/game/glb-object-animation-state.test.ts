import assert from "node:assert/strict";
import { test } from "node:test";
import {
  animationPlaybackForObjectState,
  normalizeObjectAnimationState
} from "./glb-object-animation-state";

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

// Tehkné Solutions
