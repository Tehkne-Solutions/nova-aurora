import {
  multiply4,
  parseNodeAnimationRuntime,
  slerpQuat,
  trsMatrix,
  type Mat4,
  type NodeAnimationRuntimeModel,
  type NodeAnimationSampler,
  type Quat
} from "./glb-node-animation-runtime.js";

export function parseCertifiedNodeAnimationRuntime(buffer: ArrayBuffer): NodeAnimationRuntimeModel {
  const model = parseNodeAnimationRuntime(buffer);
  for (const [clipIndex, clip] of model.clips.entries()) {
    for (const [channelIndex, channel] of clip.channels.entries()) {
      if (!model.nodes[channel.nodeIndex]) {
        throw new Error(`animation[${clipIndex}].channel[${channelIndex}] referencia node ${channel.nodeIndex} inexistente.`);
      }
    }
  }
  if (model.primitives.length === 0 && model.clips.length > 0) {
    throw new Error("GLB animado não possui primitive renderizável na scene ativa.");
  }
  return model;
}

function sampleVector(sampler: NodeAnimationSampler, timeSeconds: number, rotation: boolean): readonly number[] {
  const { times, values, components, interpolation } = sampler;
  if (times.length === 0) throw new Error("Animation sampler sem keyframes.");
  if (times.length === 1 || timeSeconds <= times[0]!) return Array.from(values.slice(0, components));
  const lastIndex = times.length - 1;
  if (timeSeconds >= times[lastIndex]!) {
    return Array.from(values.slice(lastIndex * components, (lastIndex + 1) * components));
  }

  let right = 1;
  while (right < times.length && times[right]! < timeSeconds) right += 1;
  if (times[right] === timeSeconds) {
    return Array.from(values.slice(right * components, (right + 1) * components));
  }
  const left = right - 1;
  const leftOffset = left * components;
  const rightOffset = right * components;
  if (interpolation === "STEP") return Array.from(values.slice(leftOffset, leftOffset + components));

  const leftTime = times[left]!;
  const rightTime = times[right]!;
  const t = (timeSeconds - leftTime) / (rightTime - leftTime);
  if (rotation) {
    return slerpQuat(
      [values[leftOffset]!, values[leftOffset + 1]!, values[leftOffset + 2]!, values[leftOffset + 3]!],
      [values[rightOffset]!, values[rightOffset + 1]!, values[rightOffset + 2]!, values[rightOffset + 3]!],
      t
    );
  }
  return Array.from(
    { length: components },
    (_, component) => values[leftOffset + component]! + (values[rightOffset + component]! - values[leftOffset + component]!) * t
  );
}

function sampledWorldMatrices(
  model: NodeAnimationRuntimeModel,
  translations: readonly (readonly [number, number, number])[],
  rotations: readonly Quat[],
  scales: readonly (readonly [number, number, number])[]
): readonly Mat4[] {
  const cache = new Array<Mat4 | null>(model.nodes.length).fill(null);
  const visiting = new Set<number>();
  const resolve = (index: number): Mat4 => {
    const cached = cache[index];
    if (cached) return cached;
    if (visiting.has(index)) throw new Error("Ciclo na hierarquia animada de nodes.");
    visiting.add(index);
    const local = trsMatrix(translations[index]!, rotations[index]!, scales[index]!);
    const parent = model.parents[index];
    const world = parent === null ? local : multiply4(resolve(parent!), local);
    visiting.delete(index);
    cache[index] = world;
    return world;
  };
  return model.nodes.map((_, index) => resolve(index));
}

export function sampleCertifiedNodeWorldMatrices(
  model: NodeAnimationRuntimeModel,
  clipIndex: number,
  timeSeconds: number,
  loop = true
): readonly Mat4[] {
  const clip = model.clips[clipIndex];
  const translations = model.nodes.map((node) => [...node.translation] as [number, number, number]);
  const rotations = model.nodes.map((node) => [...node.rotation] as [number, number, number, number]);
  const scales = model.nodes.map((node) => [...node.scale] as [number, number, number]);
  if (!clip) return sampledWorldMatrices(model, translations, rotations, scales);

  const duration = clip.durationSeconds;
  const time = loop && duration > 0
    ? ((timeSeconds % duration) + duration) % duration
    : Math.max(0, Math.min(timeSeconds, duration));

  for (const channel of clip.channels) {
    const sampled = sampleVector(channel.sampler, time, channel.path === "rotation");
    if (channel.path === "translation") translations[channel.nodeIndex] = [sampled[0]!, sampled[1]!, sampled[2]!];
    else if (channel.path === "scale") scales[channel.nodeIndex] = [sampled[0]!, sampled[1]!, sampled[2]!];
    else rotations[channel.nodeIndex] = [sampled[0]!, sampled[1]!, sampled[2]!, sampled[3]!];
  }
  return sampledWorldMatrices(model, translations, rotations, scales);
}

// Tehkné Solutions
