import type { NodeAnimationRuntimeModel } from "./glb-node-animation-runtime";

export type AnimationClipSelector = string | number | null | undefined;

export type ResolvedAnimationPlayback = Readonly<{
  clipIndex: number;
  clipName: string;
  durationSeconds: number;
  loop: boolean;
  animated: boolean;
  resolution: "name" | "index" | "default" | "static";
}>;

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function resolveAnimationPlayback(
  model: Pick<NodeAnimationRuntimeModel, "clips">,
  selector: AnimationClipSelector,
  loop = true
): ResolvedAnimationPlayback {
  if (model.clips.length === 0) {
    return {
      clipIndex: -1,
      clipName: "",
      durationSeconds: 0,
      loop: false,
      animated: false,
      resolution: "static"
    };
  }

  if (typeof selector === "string" && selector.trim().length > 0) {
    const wanted = normalizedName(selector);
    const clipIndex = model.clips.findIndex((clip) => normalizedName(clip.name) === wanted);
    if (clipIndex >= 0) {
      const clip = model.clips[clipIndex]!;
      return {
        clipIndex,
        clipName: clip.name,
        durationSeconds: clip.durationSeconds,
        loop,
        animated: clip.durationSeconds > 0,
        resolution: "name"
      };
    }
  }

  if (typeof selector === "number" && Number.isInteger(selector) && selector >= 0 && selector < model.clips.length) {
    const clip = model.clips[selector]!;
    return {
      clipIndex: selector,
      clipName: clip.name,
      durationSeconds: clip.durationSeconds,
      loop,
      animated: clip.durationSeconds > 0,
      resolution: "index"
    };
  }

  const fallback = model.clips[0]!;
  return {
    clipIndex: 0,
    clipName: fallback.name,
    durationSeconds: fallback.durationSeconds,
    loop,
    animated: fallback.durationSeconds > 0,
    resolution: "default"
  };
}

export function playbackTimeSeconds(playback: ResolvedAnimationPlayback, elapsedSeconds: number): number {
  if (!playback.animated || playback.durationSeconds <= 0) return 0;
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  if (!playback.loop) return Math.min(elapsed, playback.durationSeconds);
  return elapsed % playback.durationSeconds;
}

// Tehkné Solutions
