import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareGlbForAnimationState } from "./glb-animation-state-asset";

const JSON_TYPE = 0x4e4f534a;
const BIN_TYPE = 0x004e4942;

function fixture(animationNames: readonly string[]): ArrayBuffer {
  const document = {
    asset: { version: "2.0" },
    animations: animationNames.map((name) => ({ name, samplers: [], channels: [] })),
    buffers: [{ byteLength: 4 }]
  };
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.byteLength / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + 4;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_TYPE, true);
  const jsonBytes = new Uint8Array(buffer, 20, jsonLength);
  jsonBytes.fill(0x20);
  jsonBytes.set(json);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, 4, true);
  view.setUint32(binHeader + 4, BIN_TYPE, true);
  new Uint8Array(buffer, binHeader + 8, 4).set([7, 11, 13, 17]);
  return buffer;
}

function animationNames(buffer: ArrayBuffer): string[] {
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  const json = new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)).trim();
  const document = JSON.parse(json) as { animations?: { name?: string }[] };
  return (document.animations ?? []).map((animation) => animation.name ?? "");
}

function binBytes(buffer: ArrayBuffer): number[] {
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  const binHeader = 20 + jsonLength;
  const length = view.getUint32(binHeader, true);
  assert.equal(view.getUint32(binHeader + 4, true), BIN_TYPE);
  return Array.from(new Uint8Array(buffer, binHeader + 8, length));
}

test("persisted open state moves Open clip to animation index zero without changing BIN", () => {
  const source = fixture(["Idle", "Spin", "Open"]);
  const prepared = prepareGlbForAnimationState(source, "open");
  assert.equal(prepared.reordered, true);
  assert.equal(prepared.selectedClipIndex, 2);
  assert.equal(prepared.selectedClipName, "Open");
  assert.deepEqual(animationNames(prepared.buffer), ["Open", "Idle", "Spin"]);
  assert.deepEqual(binBytes(prepared.buffer), [7, 11, 13, 17]);
});

test("state matching is case insensitive and leaves clip zero stable when already selected", () => {
  const source = fixture(["idle", "Open"]);
  const prepared = prepareGlbForAnimationState(source, "idle");
  assert.equal(prepared.reordered, false);
  assert.equal(prepared.selectedClipIndex, 0);
  assert.deepEqual(animationNames(prepared.buffer), ["idle", "Open"]);
  assert.deepEqual(binBytes(prepared.buffer), [7, 11, 13, 17]);
});

test("missing requested clip preserves deterministic existing clip zero fallback", () => {
  const source = fixture(["Idle", "Spin"]);
  const prepared = prepareGlbForAnimationState(source, "activate");
  assert.equal(prepared.reordered, false);
  assert.equal(prepared.selectedClipIndex, -1);
  assert.equal(prepared.selectedClipName, null);
  assert.deepEqual(animationNames(prepared.buffer), ["Idle", "Spin"]);
});

test("malformed GLB fails closed before producing a runtime asset", () => {
  assert.throws(() => prepareGlbForAnimationState(new ArrayBuffer(8), "idle"), /GLB incompleto/);
});

// Tehkné Solutions
