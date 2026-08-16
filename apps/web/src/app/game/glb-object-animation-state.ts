import type { AnimationClipSelector } from "./glb-animation-playback";
import {
  sampleResolvedAnimationPlayback,
  type AnimationPlaybackFrame
} from "./glb-animation-playback-runtime";
import type { NodeAnimationRuntimeModel } from "./glb-node-animation-runtime";

export type ObjectAnimationState =
  | "idle"
  | "open"
  | "close"
  | "activate"
  | "deactivate"
  | "spin";

export type ObjectAnimationPlaybackPolicy = Readonly<{
  state: ObjectAnimationState;
  selector: AnimationClipSelector;
  loop: boolean;
}>;

const POLICIES: Readonly<Record<ObjectAnimationState, ObjectAnimationPlaybackPolicy>> = Object.freeze({
  idle: Object.freeze({ state: "idle", selector: Object.freeze({ name: "Idle" }), loop: true }),
  open: Object.freeze({ state: "open", selector: Object.freeze({ name: "Open" }), loop: false }),
  close: Object.freeze({ state: "close", selector: Object.freeze({ name: "Close" }), loop: false }),
  activate: Object.freeze({ state: "activate", selector: Object.freeze({ name: "Activate" }), loop: false }),
  deactivate: Object.freeze({ state: "deactivate", selector: Object.freeze({ name: "Deactivate" }), loop: false }),
  spin: Object.freeze({ state: "spin", selector: Object.freeze({ name: "Spin" }), loop: true })
});

export function animationPlaybackForObjectState(state: ObjectAnimationState): ObjectAnimationPlaybackPolicy {
  return POLICIES[state];
}

export function normalizeObjectAnimationState(value: unknown): ObjectAnimationState {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "open" || normalized === "close" || normalized === "activate" || normalized === "deactivate" || normalized === "spin") {
    return normalized;
  }
  return "idle";
}

export function sampleObjectAnimationState(
  model: NodeAnimationRuntimeModel,
  state: ObjectAnimationState,
  elapsedSeconds: number
): AnimationPlaybackFrame {
  const policy = animationPlaybackForObjectState(state);
  return sampleResolvedAnimationPlayback(model, policy.selector, elapsedSeconds, policy.loop);
}

// Tehkné Solutions
