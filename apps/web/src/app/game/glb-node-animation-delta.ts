import { multiply4, type Mat4, type NodeAnimationRuntimeModel, type Vec3 } from "./glb-node-animation-runtime.js";

type JsonObject = Record<string, unknown>;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

export type AnimationNormalization = Readonly<{
  matrix: Mat4;
  inverse: Mat4;
  center: Vec3;
  scale: number;
}>;

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

function parseGlb(buffer: ArrayBuffer): Readonly<{ document: JsonObject; bin: Uint8Array }> {
  if (buffer.byteLength < 20) throw new Error("GLB incompleto para normalização animada.");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
    throw new Error("GLB 2.0 inválido para normalização animada.");
  }
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
  if (!document) throw new Error("GLB sem JSON para normalização animada.");
  return { document, bin };
}

function floatVec3(document: JsonObject, bin: Uint8Array, accessorIndex: number, label: string): Float32Array {
  const accessors = array(document.accessors, "accessors").map((value, index) => object(value, `accessors[${index}]`));
  const views = array(document.bufferViews, "bufferViews").map((value, index) => object(value, `bufferViews[${index}]`));
  const accessor = accessors[accessorIndex];
  if (!accessor || accessor.componentType !== 5126 || accessor.type !== "VEC3" || accessor.normalized === true || accessor.sparse !== undefined) {
    throw new Error(`${label} precisa ser FLOAT VEC3 não-normalizado e não-sparse.`);
  }
  const viewIndex = integer(accessor.bufferView, `${label}.bufferView`);
  const bufferView = views[viewIndex];
  if (!bufferView) throw new Error(`${label} referencia bufferView inexistente.`);
  const count = integer(accessor.count, `${label}.count`, 1);
  const offset = Number(bufferView.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0);
  const stride = Number(bufferView.byteStride ?? 0) || 12;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(stride) || stride < 12 || offset + stride * (count - 1) + 12 > bin.byteLength) {
    throw new Error(`${label} possui faixa inválida.`);
  }
  const source = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const output = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const base = offset + index * stride;
    const x = source.getFloat32(base, true);
    const y = source.getFloat32(base + 4, true);
    const z = source.getFloat32(base + 8, true);
    if (![x, y, z].every(Number.isFinite)) throw new Error(`${label} contém valor não finito.`);
    output[index * 3] = x;
    output[index * 3 + 1] = y;
    output[index * 3 + 2] = z;
  }
  return output;
}

export function transformPoint(matrix: Mat4, point: Vec3): Vec3 {
  const x = point[0]; const y = point[1]; const z = point[2];
  const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
  const safeW = Math.abs(w) > 1e-8 ? w : 1;
  return [
    (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) / safeW,
    (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) / safeW,
    (matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) / safeW
  ];
}

export function inverse4(matrix: Mat4): number[] {
  const m = matrix;
  const out = new Array<number>(16);
  out[0] = m[5]! * m[10]! * m[15]! - m[5]! * m[11]! * m[14]! - m[9]! * m[6]! * m[15]! + m[9]! * m[7]! * m[14]! + m[13]! * m[6]! * m[11]! - m[13]! * m[7]! * m[10]!;
  out[4] = -m[4]! * m[10]! * m[15]! + m[4]! * m[11]! * m[14]! + m[8]! * m[6]! * m[15]! - m[8]! * m[7]! * m[14]! - m[12]! * m[6]! * m[11]! + m[12]! * m[7]! * m[10]!;
  out[8] = m[4]! * m[9]! * m[15]! - m[4]! * m[11]! * m[13]! - m[8]! * m[5]! * m[15]! + m[8]! * m[7]! * m[13]! + m[12]! * m[5]! * m[11]! - m[12]! * m[7]! * m[9]!;
  out[12] = -m[4]! * m[9]! * m[14]! + m[4]! * m[10]! * m[13]! + m[8]! * m[5]! * m[14]! - m[8]! * m[6]! * m[13]! - m[12]! * m[5]! * m[10]! + m[12]! * m[6]! * m[9]!;
  out[1] = -m[1]! * m[10]! * m[15]! + m[1]! * m[11]! * m[14]! + m[9]! * m[2]! * m[15]! - m[9]! * m[3]! * m[14]! - m[13]! * m[2]! * m[11]! + m[13]! * m[3]! * m[10]!;
  out[5] = m[0]! * m[10]! * m[15]! - m[0]! * m[11]! * m[14]! - m[8]! * m[2]! * m[15]! + m[8]! * m[3]! * m[14]! + m[12]! * m[2]! * m[11]! - m[12]! * m[3]! * m[10]!;
  out[9] = -m[0]! * m[9]! * m[15]! + m[0]! * m[11]! * m[13]! + m[8]! * m[1]! * m[15]! - m[8]! * m[3]! * m[13]! - m[12]! * m[1]! * m[11]! + m[12]! * m[3]! * m[9]!;
  out[13] = m[0]! * m[9]! * m[14]! - m[0]! * m[10]! * m[13]! - m[8]! * m[1]! * m[14]! + m[8]! * m[2]! * m[13]! + m[12]! * m[1]! * m[10]! - m[12]! * m[2]! * m[9]!;
  out[2] = m[1]! * m[6]! * m[15]! - m[1]! * m[7]! * m[14]! - m[5]! * m[2]! * m[15]! + m[5]! * m[3]! * m[14]! + m[13]! * m[2]! * m[7]! - m[13]! * m[3]! * m[6]!;
  out[6] = -m[0]! * m[6]! * m[15]! + m[0]! * m[7]! * m[14]! + m[4]! * m[2]! * m[15]! - m[4]! * m[3]! * m[14]! - m[12]! * m[2]! * m[7]! + m[12]! * m[3]! * m[6]!;
  out[10] = m[0]! * m[5]! * m[15]! - m[0]! * m[7]! * m[13]! - m[4]! * m[1]! * m[15]! + m[4]! * m[3]! * m[13]! + m[12]! * m[1]! * m[7]! - m[12]! * m[3]! * m[5]!;
  out[14] = -m[0]! * m[5]! * m[14]! + m[0]! * m[6]! * m[13]! + m[4]! * m[1]! * m[14]! - m[4]! * m[2]! * m[13]! - m[12]! * m[1]! * m[6]! + m[12]! * m[2]! * m[5]!;
  out[3] = -m[1]! * m[6]! * m[11]! + m[1]! * m[7]! * m[10]! + m[5]! * m[2]! * m[11]! - m[5]! * m[3]! * m[10]! - m[9]! * m[2]! * m[7]! + m[9]! * m[3]! * m[6]!;
  out[7] = m[0]! * m[6]! * m[11]! - m[0]! * m[7]! * m[10]! - m[4]! * m[2]! * m[11]! + m[4]! * m[3]! * m[10]! + m[8]! * m[2]! * m[7]! - m[8]! * m[3]! * m[6]!;
  out[11] = -m[0]! * m[5]! * m[11]! + m[0]! * m[7]! * m[9]! + m[4]! * m[1]! * m[11]! - m[4]! * m[3]! * m[9]! - m[8]! * m[1]! * m[7]! + m[8]! * m[3]! * m[5]!;
  out[15] = m[0]! * m[5]! * m[10]! - m[0]! * m[6]! * m[9]! - m[4]! * m[1]! * m[10]! + m[4]! * m[2]! * m[9]! + m[8]! * m[1]! * m[6]! - m[8]! * m[2]! * m[5]!;
  const determinant = m[0]! * out[0]! + m[1]! * out[4]! + m[2]! * out[8]! + m[3]! * out[12]!;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) throw new Error("Matriz 4x4 não inversível para animação.");
  return out.map((value) => value / determinant);
}

export function normalMatrix3(matrix: Mat4): Float32Array {
  const inverse = inverse4(matrix);
  return new Float32Array([
    inverse[0]!, inverse[4]!, inverse[8]!,
    inverse[1]!, inverse[5]!, inverse[9]!,
    inverse[2]!, inverse[6]!, inverse[10]!
  ]);
}

export function animatedNormalizedDelta(baseWorld: Mat4, animatedWorld: Mat4, normalization: AnimationNormalization): Mat4 {
  return multiply4(
    multiply4(multiply4(normalization.matrix, animatedWorld), inverse4(baseWorld)),
    normalization.inverse
  );
}

function sourceWorldPoints(buffer: ArrayBuffer, model: NodeAnimationRuntimeModel): Vec3[] {
  const { document, bin } = parseGlb(buffer);
  const nodes = array(document.nodes, "nodes").map((value, index) => object(value, `nodes[${index}]`));
  const meshes = array(document.meshes, "meshes").map((value, index) => object(value, `meshes[${index}]`));
  const scenes = array(document.scenes, "scenes").map((value, index) => object(value, `scenes[${index}]`));
  const sceneIndex = document.scene === undefined ? 0 : integer(document.scene, "scene");
  const roots = scenes[sceneIndex] ? array(scenes[sceneIndex]!.nodes, `scenes[${sceneIndex}].nodes`).map((value) => integer(value, "scene.nodes[]")) : nodes.map((_, index) => index);
  const output: Vec3[] = [];
  let primitiveOrder = 0;
  const visited = new Set<number>();
  const visit = (nodeIndex: number) => {
    if (visited.has(nodeIndex)) return;
    visited.add(nodeIndex);
    const node = nodes[nodeIndex];
    if (!node) throw new Error(`node ${nodeIndex} inexistente.`);
    if (node.mesh !== undefined) {
      const mesh = meshes[integer(node.mesh, `nodes[${nodeIndex}].mesh`)];
      if (!mesh) throw new Error(`mesh de node ${nodeIndex} inexistente.`);
      for (const rawPrimitive of array(mesh.primitives, "mesh.primitives")) {
        const primitive = object(rawPrimitive, "primitive");
        const attributes = object(primitive.attributes, "primitive.attributes");
        const positionAccessor = integer(attributes.POSITION, "primitive.POSITION");
        const positions = floatVec3(document, bin, positionAccessor, "primitive.POSITION");
        const profile = model.primitives[primitiveOrder];
        if (!profile || profile.nodeIndex !== nodeIndex) throw new Error("Ordem primitive→node divergiu do runtime PBR.");
        for (let offset = 0; offset < positions.length; offset += 3) {
          output.push(transformPoint(profile.baseWorld, [positions[offset]!, positions[offset + 1]!, positions[offset + 2]!]));
        }
        primitiveOrder += 1;
      }
    }
    for (const child of array(node.children, `nodes[${nodeIndex}].children`)) visit(integer(child, `nodes[${nodeIndex}].children[]`));
  };
  for (const root of roots) visit(root);
  if (primitiveOrder !== model.primitives.length) throw new Error("Contagem de primitives divergiu ao reconstruir bounds.");
  return output;
}

export function computeAnimationNormalization(buffer: ArrayBuffer, model: NodeAnimationRuntimeModel): AnimationNormalization {
  const points = sourceWorldPoints(buffer, model);
  if (points.length === 0) throw new Error("GLB sem posições para normalização animada.");
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (const [x, y, z] of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!Number.isFinite(extent) || extent <= 0) throw new Error("GLB com bounds degenerados para animação.");
  const center: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const scale = 1.55 / extent;
  const matrix: Mat4 = [
    scale, 0, 0, 0,
    0, scale, 0, 0,
    0, 0, scale, 0,
    -center[0] * scale, -center[1] * scale, -center[2] * scale, 1
  ];
  const inverse: Mat4 = [
    1 / scale, 0, 0, 0,
    0, 1 / scale, 0, 0,
    0, 0, 1 / scale, 0,
    center[0], center[1], center[2], 1
  ];
  return { matrix, inverse, center, scale };
}

// Tehkné Solutions
