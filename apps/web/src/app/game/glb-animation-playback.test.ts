import assert from "node:assert/strict";
import { test } from "node:test";
import { playbackTimeSeconds, resolveAnimationPlayback } from "./glb-animation-playback.js";

const model = {
  clips: [
    { name: "Idle", durationSeconds: 2, channels: [] },
    { name: "Open", durationSeconds: 1.25, channels: [] },
    { name: "Close", durationSeconds: 0.75, channels: [] }
  ]
};

test("resolves animation clip by case-insensitive trimmed name", () => {
  const playback = resolveAnimationPlayback(model, "  open  ", false);
  assert.equal(playback.clipIndex, 1);
  assert.equal(playback.clipName, "Open");
  assert.equal(playback.loop, false);
  assert.equal(playback.resolution, "name");
});

test("resolves animation clip by valid index", () => {
  const playback = resolveAnimationPlayback(model, 2);
  assert.equal(playback.clipIndex, 2);
  assert.equal(playback.clipName, "Close");
  assert.equal(playback.resolution, "index");
});

test("invalid selector falls back deterministically to first clip", () => {
  assert.deepEqual(resolveAnimationPlayback(model, "missing").clipIndex, 0);
  assert.deepEqual(resolveAnimationPlayback(model, 99).clipIndex, 0);
  assert.equal(resolveAnimationPlayback(model, "missing").resolution, "default");
});

test("model without clips resolves as static and never loops", () => {
  const playback = resolveAnimationPlayback({ clips: [] }, "Idle", true);
  assert.equal(playback.clipIndex, -1);
  assert.equal(playback.animated, false);
  assert.equal(playback.loop, false);
  assert.equal(playback.resolution, "static");
});

test("loop playback wraps at duration and clamp playback stops at the end", () => {
  const looping = resolveAnimationPlayback(model, "Idle", true);
  const clamped = resolveAnimationPlayback(model, "Idle", false);
  assert.equal(playbackTimeSeconds(looping, 5.25), 1.25);
  assert.equal(playbackTimeSeconds(clamped, 5.25), 2);
});

test("invalid elapsed time fails safe to frame zero", () => {
  const playback = resolveAnimationPlayback(model, "Idle", true);
  assert.equal(playbackTimeSeconds(playback, Number.NaN), 0);
  assert.equal(playbackTimeSeconds(playback, Number.POSITIVE_INFINITY), 0);
  assert.equal(playbackTimeSeconds(playback, -3), 0);
});

// Tehkné Solutions
