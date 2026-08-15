export type AnimationInterpolation = "LINEAR" | "STEP";
export type AnimationTargetPath = "translation" | "rotation" | "scale";
export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];
export type Mat4 = readonly number[];

type JsonObject = Record<string, unknown>;
type ParsedGlb = Readonly<{ document: JsonObject; bin: Uint8Array }>;

type NodeTrs = Readonly<{
  translation: Vec3;
  rotation: Quat;
  scale: Vec3;
}>;

export type NodeAnimationSampler = Readonly<{
  times: Float32Array;
  values: Float32Array;
  components: 3 | 4;
  interpolation: AnimationInterpolation;
}>;

export type NodeAnimationChannel = Readonly<{
  nodeIndex: number;
  path: AnimationTargetPath;
  sampler: NodeAnimationSampler;
}>;

export type NodeAnimationClip = Readonly<{
  name: string;
  durationSeconds: number;
  channels: readonly NodeAnimationChannel[];
}>;

export type AnimatedNodePrimitive = Readonly<{
  nodeIndex: number;
  primitiveIndex: number;
  baseWorld: Mat4;
}>;

export type NodeAnimationRuntimeModel = Readonly<{
  nodes: readonly NodeTrs[];
  parents: readonly (number | null)[];
  primitives: readonly AnimatedNodePrimitive[];
  clips: readonly NodeAnimationClip[];
  animationModel: "node-trs-linear-step-v1";
}>;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} precisa ser objeto.`);
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} precisa ser array.`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) throw new Error(`${label} precisa ser inteiro >= ${minimum}.`);
  return Number(value);
}

function finite(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} precisa ser finito.`);
  return parsed;
}

function vec3(value: unknown, fallback: Vec3, label: string): Vec3 {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} precisa ser VEC3.`);
  return [finite(value[0], `${label}[0]`), finite(value[1], `${label}[1]`), finite(value[2], `${label}[2]`)];
}

function quat(value: unknown, fallback: Quat, label: string): Quat {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.length !== 4) throw new Error(`${label} precisa ser quaternion VEC4.`);
  return normalizeQuat([
    finite(value[0], `${label}[0]`), finite(value[1], `${label}[1]`), finite(value[2], `${label}[2]`), finite(value[3], `${label}[3]`)
  ]);
}

function parseGlb(buffer: ArrayBuffer): ParsedGlb {
  if (buffer.byteLength < 20) throw new Error("GLB incompleto.");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) throw new Error("GLB 2.0 inválido.");
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error("Comprimento GLB inconsistente.");
  let offset = 12;
  let document: JsonObject | null = null;
  let bin = new Uint8Array(0);
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > buffer.byteLength) throw new Error("Chunk GLB truncado.");
    const chunk = new Uint8Array(buffer, offset, length);
    if (type === GLB_JSON_CHUNK && !document) {
      document = object(JSON.parse(new TextDecoder().decode(chunk).replace(/[\u0000\u0020]+$/g, "")), "Documento glTF");
    } else if (type === GLB_BIN_CHUNK && bin.byteLength === 0) {
      bin = new Uint8Array(chunk);
    }
    offset += length;
  }
  if (!document || object(document.asset, "asset").version !== "2.0") throw new Error("Documento glTF 2.0 ausente.");
  return { document, bin };
}

function accessor(document: JsonObject, bin: Uint8Array, index: number, expectedType: "SCALAR" | "VEC3" | "VEC4", label: string): Float32Array {
  const accessors = array(document.accessors, "accessors").map((value, position) => object(value, `accessors[${position}]`));
  const views = array(document.bufferViews, "bufferViews").map((value, position) => object(value, `bufferViews[${position}]`));
  const item = accessors[index];
  if (!item || item.componentType !== 5126 || item.type !== expectedType || item.normalized === true || item.sparse !== undefined) {
    throw new Error(`${label} precisa ser FLOAT ${expectedType} não-normalizado e não-sparse.`);
  }
  const viewIndex = integer(item.bufferView, `${label}.bufferView`);
  const bufferView = views[viewIndex];
  if (!bufferView) throw new Error(`${label} referencia bufferView inexistente.`);
  const count = integer(item.count, `${label}.count`, 1);
  const components = expectedType === "SCALAR" ? 1 : expectedType === "VEC3" ? 3 : 4;
  const elementBytes = components * 4;
  const stride = Number(bufferView.byteStride ?? 0) || elementBytes;
  const offset = Number(bufferView.byteOffset ?? 0) + Number(item.byteOffset ?? 0);
  if (!Number.isInteger(stride) || stride < elementBytes || !Number.isInteger(offset) || offset < 0) throw new Error(`${label} possui layout inválido.`);
  if (offset + stride * (count - 1) + elementBytes > bin.byteLength) throw new Error(`${label} fora do BIN.`);
  const source = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const output = new Float32Array(count * components);
  for (let key = 0; key < count; key += 1) {
    const base = offset + key * stride;
    for (let component = 0; component < components; component += 1) {
      const value = source.getFloat32(base + component * 4, true);
      if (!Number.isFinite(value)) throw new Error(`${label} contém valor não finito.`);
      output[key * components + component] = value;
    }
  }
  return output;
}

export function identity4(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function multiply4(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] = a[row]! * b[column * 4]! + a[4 + row]! * b[column * 4 + 1]! + a[8 + row]! * b[column * 4 + 2]! + a[12 + row]! * b[column * 4 + 3]!;
    }
  }
  return out;
}

function normalizeQuat(value: Quat): [number, number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  if (!Number.isFinite(length) || length <= 1e-8) throw new Error("Quaternion degenerado.");
  return [value[0] / length, value[1] / length, value[2] / length, value[3] / length];
}

export function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let right: Quat = b;
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (cos < 0) {
    right = [-b[0], -b[1], -b[2], -b[3]];
    cos = -cos;
  }
  if (cos > 0.9995) {
    return normalizeQuat([
      a[0] + (right[0] - a[0]) * t,
      a[1] + (right[1] - a[1]) * t,
      a[2] + (right[2] - a[2]) * t,
      a[3] + (right[3] - a[3]) * t
    ]);
  }
  const theta = Math.acos(Math.min(1, Math.max(-1, cos)));
  const sinTheta = Math.sin(theta);
  const leftWeight = Math.sin((1 - t) * theta) / sinTheta;
  const rightWeight = Math.sin(t * theta) / sinTheta;
  return normalizeQuat([
    a[0] * leftWeight + right[0] * rightWeight,
    a[1] * leftWeight + right[1] * rightWeight,
    a[2] * leftWeight + right[2] * rightWeight,
    a[3] * leftWeight + right[3] * rightWeight
  ]);
}

export function trsMatrix(translation: Vec3, rotation: Quat, scale: Vec3): number[] {
  const [x, y, z, w] = normalizeQuat(rotation);
  const xx = x * x; const yy = y * y; const zz = z * z;
  const xy = x * y; const xz = x * z; const yz = y * z;
  const wx = w * x; const wy = w * y; const wz = w * z;
  const [sx, sy, sz] = scale;
  return [
    (1 - 2 * (yy + zz)) * sx, (2 * (xy + wz)) * sx, (2 * (xz - wy)) * sx, 0,
    (2 * (xy - wz)) * sy, (1 - 2 * (xx + zz)) * sy, (2 * (yz + wx)) * sy, 0,
    (2 * (xz + wy)) * sz, (2 * (yz - wx)) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    translation[0], translation[1], translation[2], 1
  ];
}

function readNodeTrs(node: JsonObject, index: number): NodeTrs {
  if (node.matrix !== undefined) throw new Error(`node[${index}] usa matrix; runtime animado exige TRS.`);
  return {
    translation: vec3(node.translation, [0, 0, 0], `nodes[${index}].translation`),
    rotation: quat(node.rotation, [0, 0, 0, 1], `nodes[${index}].rotation`),
    scale: vec3(node.scale, [1, 1, 1], `nodes[${index}].scale`)
  };
}

function parentsOf(nodes: readonly JsonObject[]): (number | null)[] {
  const parents = new Array<number | null>(nodes.length).fill(null);
  for (let parent = 0; parent < nodes.length; parent += 1) {
    for (const rawChild of array(nodes[parent]!.children, `nodes[${parent}].children`)) {
      const child = integer(rawChild, `nodes[${parent}].children[]`);
      if (child >= nodes.length) throw new Error(`node child ${child} inexistente.`);
      if (parents[child] !== null) throw new Error(`node ${child} possui múltiplos parents.`);
      parents[child] = parent;
    }
  }
  return parents;
}

function worldMatrices(nodes: readonly NodeTrs[], parents: readonly (number | null)[]): Mat4[] {
  const cache = new Array<Mat4 | null>(nodes.length).fill(null);
  const visiting = new Set<number>();
  const resolve = (index: number): Mat4 => {
    const existing = cache[index];
    if (existing) return existing;
    if (visiting.has(index)) throw new Error("Ciclo na hierarquia de nodes.");
    visiting.add(index);
    const local = trsMatrix(nodes[index]!.translation, nodes[index]!.rotation, nodes[index]!.scale);
    const parent = parents[index];
    if (parent === undefined) throw new Error(`Parent de node ${index} não foi materializado.`);
    const world = parent === null ? local : multiply4(resolve(parent), local);
    visiting.delete(index);
    cache[index] = world;
    return world;
  };
  return nodes.map((_, index) => resolve(index));
}

function primitiveProfiles(document: JsonObject, baseWorld: readonly Mat4[]): AnimatedNodePrimitive[] {
  const nodes = array(document.nodes, "nodes").map((value, position) => object(value, `nodes[${position}]`));
  const meshes = array(document.meshes, "meshes").map((value, position) => object(value, `meshes[${position}]`));
  const scenes = array(document.scenes, "scenes").map((value, position) => object(value, `scenes[${position}]`));
  const sceneIndex = document.scene === undefined ? 0 : integer(document.scene, "scene");
  const roots = scenes[sceneIndex] ? array(scenes[sceneIndex]!.nodes, `scenes[${sceneIndex}].nodes`).map(Number) : nodes.map((_, index) => index);
  const output: AnimatedNodePrimitive[] = [];
  const visited = new Set<number>();
  const visit = (nodeIndex: number) => {
    if (visited.has(nodeIndex)) return;
    visited.add(nodeIndex);
    const node = nodes[nodeIndex];
    if (!node) throw new Error(`node ${nodeIndex} inexistente.`);
    if (node.mesh !== undefined) {
      const meshIndex = integer(node.mesh, `nodes[${nodeIndex}].mesh`);
      const mesh = meshes[meshIndex];
      if (!mesh) throw new Error(`mesh ${meshIndex} inexistente.`);
      for (const [primitiveIndex] of array(mesh.primitives, `meshes[${meshIndex}].primitives`).entries()) {
        output.push({ nodeIndex, primitiveIndex, baseWorld: baseWorld[nodeIndex]! });
      }
    }
    for (const child of array(node.children, `nodes[${nodeIndex}].children`)) visit(integer(child, `nodes[${nodeIndex}].children[]`));
  };
  for (const root of roots) visit(integer(root, "scene.nodes[]"));
  return output;
}

function clip(document: JsonObject, bin: Uint8Array, animation: JsonObject, animationIndex: number): NodeAnimationClip {
  const rawSamplers = array(animation.samplers, `animations[${animationIndex}].samplers`).map((value, index) => object(value, `animations[${animationIndex}].samplers[${index}]`));
  const rawChannels = array(animation.channels, `animations[${animationIndex}].channels`).map((value, index) => object(value, `animations[${animationIndex}].channels[${index}]`));
  const samplers = rawSamplers.map((raw, samplerIndex): Readonly<{ input: Float32Array; outputAccessor: number; interpolation: AnimationInterpolation }> => {
    const interpolation = String(raw.interpolation ?? "LINEAR");
    if (interpolation !== "LINEAR" && interpolation !== "STEP") throw new Error(`animation sampler interpolation ${interpolation} não suportada.`);
    const input = accessor(document, bin, integer(raw.input, `sampler[${samplerIndex}].input`), "SCALAR", `animation[${animationIndex}].sampler[${samplerIndex}].input`);
    for (let index = 1; index < input.length; index += 1) if (input[index]! <= input[index - 1]!) throw new Error("Animation input precisa ser estritamente crescente.");
    return { input, outputAccessor: integer(raw.output, `sampler[${samplerIndex}].output`), interpolation };
  });
  const channels = rawChannels.map((raw, channelIndex): NodeAnimationChannel => {
    const samplerIndex = integer(raw.sampler, `channel[${channelIndex}].sampler`);
    const source = samplers[samplerIndex];
    if (!source) throw new Error(`channel ${channelIndex} referencia sampler inexistente.`);
    const target = object(raw.target, `channel[${channelIndex}].target`);
    const nodeIndex = integer(target.node, `channel[${channelIndex}].target.node`);
    const path = String(target.path ?? "");
    if (path !== "translation" && path !== "rotation" && path !== "scale") throw new Error(`Animation target ${path} não suportado.`);
    const components = path === "rotation" ? 4 : 3;
    const values = accessor(document, bin, source.outputAccessor, path === "rotation" ? "VEC4" : "VEC3", `animation[${animationIndex}].channel[${channelIndex}].output`);
    if (values.length / components !== source.input.length) throw new Error("Animation input/output count divergem.");
    return { nodeIndex, path, sampler: { times: source.input, values, components, interpolation: source.interpolation } };
  });
  const durationSeconds = samplers.reduce((maximum, sampler) => Math.max(maximum, sampler.input[sampler.input.length - 1] ?? 0), 0);
  return { name: typeof animation.name === "string" && animation.name.trim() ? animation.name.trim() : `Animation ${animationIndex + 1}`, durationSeconds, channels };
}

export function parseNodeAnimationRuntime(buffer: ArrayBuffer): NodeAnimationRuntimeModel {
  const { document, bin } = parseGlb(buffer);
  const rawNodes = array(document.nodes, "nodes").map((value, index) => object(value, `nodes[${index}]`));
  const nodes = rawNodes.map(readNodeTrs);
  const parents = parentsOf(rawNodes);
  const baseWorld = worldMatrices(nodes, parents);
  const clips = array(document.animations, "animations").map((value, index) => clip(document, bin, object(value, `animations[${index}]`), index));
  return { nodes, parents, primitives: primitiveProfiles(document, baseWorld), clips, animationModel: "node-trs-linear-step-v1" };
}

function sampleValues(sampler: NodeAnimationSampler, timeSeconds: number, rotation: boolean): readonly number[] {
  const { times, values, components, interpolation } = sampler;
  if (times.length === 1 || timeSeconds <= times[0]!) return Array.from(values.slice(0, components));
  if (timeSeconds >= times[times.length - 1]!) return Array.from(values.slice((times.length - 1) * components, times.length * components));
  let right = 1;
  while (right < times.length && times[right]! < timeSeconds) right += 1;
  const left = right - 1;
  const leftTime = times[left]!;
  const rightTime = times[right]!;
  const leftOffset = left * components;
  const rightOffset = right * components;
  if (interpolation === "STEP") return Array.from(values.slice(leftOffset, leftOffset + components));
  const t = (timeSeconds - leftTime) / (rightTime - leftTime);
  if (rotation) {
    return slerpQuat(
      [values[leftOffset]!, values[leftOffset + 1]!, values[leftOffset + 2]!, values[leftOffset + 3]!],
      [values[rightOffset]!, values[rightOffset + 1]!, values[rightOffset + 2]!, values[rightOffset + 3]!],
      t
    );
  }
  return Array.from({ length: components }, (_, component) => values[leftOffset + component]! + (values[rightOffset + component]! - values[leftOffset + component]!) * t);
}

export function sampleNodeWorldMatrices(model: NodeAnimationRuntimeModel, clipIndex: number, timeSeconds: number, loop = true): readonly Mat4[] {
  const selected = model.clips[clipIndex];
  if (!selected) return worldMatrices(model.nodes, model.parents);
  const duration = selected.durationSeconds;
  const time = loop && duration > 0 ? ((timeSeconds % duration) + duration) % duration : Math.max(0, Math.min(timeSeconds, duration));
  const mutable = model.nodes.map((node) => ({ translation: [...node.translation] as [number, number, number], rotation: [...node.rotation] as [number, number, number, number], scale: [...node.scale] as [number, number, number] }));
  for (const channel of selected.channels) {
    const sampled = sampleValues(channel.sampler, time, channel.path === "rotation");
    const node = mutable[channel.nodeIndex];
    if (!node) throw new Error(`Animation target node ${channel.nodeIndex} inexistente.`);
    if (channel.path === "translation") node.translation = [sampled[0]!, sampled[1]!, sampled[2]!];
    else if (channel.path === "scale") node.scale = [sampled[0]!, sampled[1]!, sampled[2]!];
    else node.rotation = normalizeQuat([sampled[0]!, sampled[1]!, sampled[2]!, sampled[3]!]);
  }
  return worldMatrices(mutable, model.parents);
}

// Tehkné Solutions
