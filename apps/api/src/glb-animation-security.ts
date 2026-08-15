import { GlbSecurityError } from "./glb-structural-security.js";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

export const GLB_ANIMATION_LIMITS = Object.freeze({
  maxAnimations: 32,
  maxSamplersPerAnimation: 128,
  maxChannelsPerAnimation: 256,
  maxKeyframesPerSampler: 4096,
  maxTotalKeyframes: 32768,
  maxDurationSeconds: 120
});

export type GlbAnimationSecurityReport = Readonly<{
  version: 1;
  animations: number;
  samplers: number;
  channels: number;
  animatedNodes: number;
  translationChannels: number;
  rotationChannels: number;
  scaleChannels: number;
  totalKeyframes: number;
  maxDurationSeconds: number;
  interpolations: readonly ("LINEAR" | "STEP")[];
  signature: "Tehkné Solutions";
}>;

type JsonObject = Record<string, unknown>;

function fail(code: string, message: string): never {
  throw new GlbSecurityError(code, message);
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("animation-json-shape", `${label} precisa ser objeto.`);
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("animation-json-shape", `${label} precisa ser array.`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) fail("animation-integer", `${label} precisa ser inteiro >= ${minimum}.`);
  return Number(value);
}

function parseGlb(bytes: Buffer): { document: JsonObject; bin: Buffer } {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== GLB_MAGIC || bytes.readUInt32LE(4) !== 2) {
    fail("animation-container", "GLB 2.0 inválido para validação de animação.");
  }
  let offset = 12;
  let document: JsonObject | null = null;
  let bin = Buffer.alloc(0);
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + length > bytes.length) fail("animation-container", "Chunk GLB truncado.");
    const chunk = bytes.subarray(offset, offset + length);
    if (type === GLB_JSON_CHUNK && !document) {
      try {
        document = object(JSON.parse(chunk.toString("utf8").replace(/[\u0000\u0020]+$/g, "")), "Documento glTF");
      } catch (error) {
        if (error instanceof GlbSecurityError) throw error;
        fail("animation-json", "JSON GLB inválido.");
      }
    } else if (type === GLB_BIN_CHUNK && bin.length === 0) {
      bin = Buffer.from(chunk);
    }
    offset += length;
  }
  if (!document) fail("animation-json", "GLB sem documento JSON.");
  return { document, bin };
}

function accessorWindow(document: JsonObject, bin: Buffer, accessorIndex: number, label: string): {
  accessor: JsonObject;
  view: JsonObject;
  offset: number;
  stride: number;
} {
  const accessors = array(document.accessors, "accessors").map((value, index) => object(value, `accessors[${index}]`));
  const views = array(document.bufferViews, "bufferViews").map((value, index) => object(value, `bufferViews[${index}]`));
  if (accessorIndex >= accessors.length) fail("animation-accessor", `${label} referencia accessor inexistente.`);
  const accessor = accessors[accessorIndex]!;
  if (accessor.sparse !== undefined) fail("animation-sparse", `${label} usa sparse accessor, fora do perfil 23.17.`);
  const viewIndex = integer(accessor.bufferView, `${label}.bufferView`);
  if (viewIndex >= views.length) fail("animation-accessor", `${label} referencia bufferView inexistente.`);
  const view = views[viewIndex]!;
  const offset = Number(view.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0);
  const stride = Number(view.byteStride ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(stride) || stride < 0) fail("animation-accessor", `${label} possui offsets inválidos.`);
  if (offset > bin.length) fail("animation-accessor", `${label} inicia fora do BIN.`);
  return { accessor, view, offset, stride };
}

function readFloatAccessor(document: JsonObject, bin: Buffer, accessorIndex: number, expectedType: "SCALAR" | "VEC3" | "VEC4", label: string): Float32Array {
  const { accessor, offset, stride } = accessorWindow(document, bin, accessorIndex, label);
  if (Number(accessor.componentType) !== 5126 || accessor.type !== expectedType || accessor.normalized === true) {
    fail("animation-accessor-format", `${label} precisa ser FLOAT ${expectedType} não-normalizado.`);
  }
  const count = integer(accessor.count, `${label}.count`, 1);
  const components = expectedType === "SCALAR" ? 1 : expectedType === "VEC3" ? 3 : 4;
  const elementBytes = components * 4;
  const itemStride = stride || elementBytes;
  if (itemStride < elementBytes || offset + itemStride * (count - 1) + elementBytes > bin.length) {
    fail("animation-accessor-range", `${label} ultrapassa o BIN.`);
  }
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Float32Array(count * components);
  for (let index = 0; index < count; index += 1) {
    const base = offset + index * itemStride;
    for (let component = 0; component < components; component += 1) {
      const value = view.getFloat32(base + component * 4, true);
      if (!Number.isFinite(value)) fail("animation-non-finite", `${label} contém valor não finito.`);
      out[index * components + component] = value;
    }
  }
  return out;
}

function validateTimes(times: Float32Array, label: string): number {
  if (times.length > GLB_ANIMATION_LIMITS.maxKeyframesPerSampler) {
    fail("animation-keyframe-limit", `${label} excede ${GLB_ANIMATION_LIMITS.maxKeyframesPerSampler} keyframes.`);
  }
  let previous = -Infinity;
  for (let index = 0; index < times.length; index += 1) {
    const value = times[index]!;
    if (value < 0) fail("animation-negative-time", `${label}[${index}] não pode ser negativo.`);
    if (value <= previous) fail("animation-time-order", `${label} precisa ser estritamente crescente.`);
    previous = value;
  }
  const duration = times[times.length - 1] ?? 0;
  if (duration > GLB_ANIMATION_LIMITS.maxDurationSeconds) {
    fail("animation-duration-limit", `${label} excede ${GLB_ANIMATION_LIMITS.maxDurationSeconds}s.`);
  }
  return duration;
}

function validateRotations(values: Float32Array, label: string): void {
  for (let offset = 0; offset < values.length; offset += 4) {
    const length = Math.hypot(values[offset]!, values[offset + 1]!, values[offset + 2]!, values[offset + 3]!);
    if (Math.abs(length - 1) > 0.01) fail("animation-quaternion", `${label} contém quaternion não unitário.`);
  }
}

export function validateGlbNodeAnimations(bytes: Buffer): GlbAnimationSecurityReport {
  const { document, bin } = parseGlb(bytes);
  const animations = array(document.animations, "animations").map((value, index) => object(value, `animations[${index}]`));
  const nodes = array(document.nodes, "nodes").map((value, index) => object(value, `nodes[${index}]`));
  if (animations.length > GLB_ANIMATION_LIMITS.maxAnimations) fail("animation-count-limit", `animations excede ${GLB_ANIMATION_LIMITS.maxAnimations}.`);

  let samplerCount = 0;
  let channelCount = 0;
  let totalKeyframes = 0;
  let maxDurationSeconds = 0;
  let translationChannels = 0;
  let rotationChannels = 0;
  let scaleChannels = 0;
  const animatedNodes = new Set<number>();
  const interpolations = new Set<"LINEAR" | "STEP">();

  for (let animationIndex = 0; animationIndex < animations.length; animationIndex += 1) {
    const animation = animations[animationIndex]!;
    const samplers = array(animation.samplers, `animations[${animationIndex}].samplers`).map((value, index) => object(value, `animations[${animationIndex}].samplers[${index}]`));
    const channels = array(animation.channels, `animations[${animationIndex}].channels`).map((value, index) => object(value, `animations[${animationIndex}].channels[${index}]`));
    if (samplers.length > GLB_ANIMATION_LIMITS.maxSamplersPerAnimation) fail("animation-sampler-limit", `animation[${animationIndex}] possui samplers demais.`);
    if (channels.length > GLB_ANIMATION_LIMITS.maxChannelsPerAnimation) fail("animation-channel-limit", `animation[${animationIndex}] possui channels demais.`);
    samplerCount += samplers.length;
    channelCount += channels.length;

    const samplerProfiles = samplers.map((sampler, samplerIndex) => {
      const interpolation = String(sampler.interpolation ?? "LINEAR");
      if (interpolation !== "LINEAR" && interpolation !== "STEP") {
        fail("animation-interpolation", `animations[${animationIndex}].samplers[${samplerIndex}] interpolation=${interpolation} fora do perfil 23.17.`);
      }
      interpolations.add(interpolation);
      const input = integer(sampler.input, `animations[${animationIndex}].samplers[${samplerIndex}].input`);
      const output = integer(sampler.output, `animations[${animationIndex}].samplers[${samplerIndex}].output`);
      const times = readFloatAccessor(document, bin, input, "SCALAR", `animation[${animationIndex}].sampler[${samplerIndex}].input`);
      const duration = validateTimes(times, `animation[${animationIndex}].sampler[${samplerIndex}].input`);
      maxDurationSeconds = Math.max(maxDurationSeconds, duration);
      totalKeyframes += times.length;
      if (totalKeyframes > GLB_ANIMATION_LIMITS.maxTotalKeyframes) fail("animation-total-keyframe-limit", `GLB excede ${GLB_ANIMATION_LIMITS.maxTotalKeyframes} keyframes totais.`);
      return { output, count: times.length };
    });

    const targets = new Set<string>();
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const channel = channels[channelIndex]!;
      const samplerIndex = integer(channel.sampler, `animations[${animationIndex}].channels[${channelIndex}].sampler`);
      if (samplerIndex >= samplerProfiles.length) fail("animation-sampler-reference", `channel referencia sampler inexistente.`);
      const target = object(channel.target, `animations[${animationIndex}].channels[${channelIndex}].target`);
      const nodeIndex = integer(target.node, `animations[${animationIndex}].channels[${channelIndex}].target.node`);
      if (nodeIndex >= nodes.length) fail("animation-node-reference", `channel referencia node inexistente.`);
      const path = String(target.path ?? "");
      if (path !== "translation" && path !== "rotation" && path !== "scale") {
        fail("animation-target-path", `target.path=${path || "ausente"} fora do perfil 23.17.`);
      }
      if (nodes[nodeIndex]!.matrix !== undefined) fail("animation-node-matrix", `node ${nodeIndex} animado usa matrix; runtime 23.17 exige TRS.`);
      const targetKey = `${nodeIndex}:${path}`;
      if (targets.has(targetKey)) fail("animation-duplicate-target", `animation[${animationIndex}] possui channels duplicados para ${targetKey}.`);
      targets.add(targetKey);
      animatedNodes.add(nodeIndex);

      const sampler = samplerProfiles[samplerIndex]!;
      const expectedType = path === "rotation" ? "VEC4" : "VEC3";
      const values = readFloatAccessor(document, bin, sampler.output, expectedType, `animation[${animationIndex}].channel[${channelIndex}].output`);
      const components = expectedType === "VEC4" ? 4 : 3;
      if (values.length / components !== sampler.count) fail("animation-count-mismatch", `input/output count divergem no channel ${channelIndex}.`);
      if (path === "rotation") {
        validateRotations(values, `animation[${animationIndex}].channel[${channelIndex}].rotation`);
        rotationChannels += 1;
      } else if (path === "translation") {
        translationChannels += 1;
      } else {
        scaleChannels += 1;
      }
    }
  }

  return {
    version: 1,
    animations: animations.length,
    samplers: samplerCount,
    channels: channelCount,
    animatedNodes: animatedNodes.size,
    translationChannels,
    rotationChannels,
    scaleChannels,
    totalKeyframes,
    maxDurationSeconds,
    interpolations: Array.from(interpolations).sort(),
    signature: "Tehkné Solutions"
  };
}

// Tehkné Solutions
