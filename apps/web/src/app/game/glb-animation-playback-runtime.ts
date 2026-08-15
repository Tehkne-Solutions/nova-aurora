import {
  playbackTimeSeconds,
  resolveAnimationPlayback,
  type AnimationClipSelector,
  type ResolvedAnimationPlayback
} from "./glb-animation-playback";
import type { Mat4, NodeAnimationRuntimeModel } from "./glb-node-animation-runtime";
import { sampleCertifiedNodeWorldMatrices } from "./glb-node-animation-sampling";

export type AnimationPlaybackFrame = Readonly<{
  playback: ResolvedAnimationPlayback;
  timeSeconds: number;
  worlds: readonly Mat4[];
}>;

export function sampleResolvedAnimationPlayback(
  model: NodeAnimationRuntimeModel,
  selector: AnimationClipSelector,
  elapsedSeconds: number,
  loop = true
): AnimationPlaybackFrame {
  const playback = resolveAnimationPlayback(model, selector, loop);
  if (!playback.animated || playback.clipIndex < 0) {
    return {
      playback,
      timeSeconds: 0,
      worlds: sampleCertifiedNodeWorldMatrices(model, -1, 0, false)
    };
  }

  const timeSeconds = playbackTimeSeconds(playback, elapsedSeconds);
  return {
    playback,
    timeSeconds,
    worlds: sampleCertifiedNodeWorldMatrices(model, playback.clipIndex, timeSeconds, false)
  };
}

// Tehkné Solutions
