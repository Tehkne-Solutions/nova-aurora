export type LitDrawable = Readonly<{
  positions: Float32Array;
  normals: Float32Array;
  color: readonly [number, number, number, number];
  doubleSided: boolean;
  normalSource: "accessor" | "flat-fallback";
}>;

export type LitGlbModel = Readonly<{
  drawables: readonly LitDrawable[];
  explicitNormalPrimitives: number;
  fallbackNormalPrimitives: number;
}>;

type Vec3 = readonly [number, number, number];
type Mat4 = readonly number[];

type GltfAccessor = Readonly<{
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}>;

type GltfBufferView = Readonly<{
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}>;

type GltfPrimitive = Readonly<{
  attributes?: Readonly<Record<string, number>>;
  indices?: number;
  material?: number;
  mode?: number;
}>;

type GltfMesh = Readonly<{ primitives?: readonly GltfPrimitive[] }>;
type GltfNode = Readonly<{
  mesh?: number;
  children?: readonly number[];
  matrix?: readonly number[];
  translation?: readonly number[];
  rotation?: readonly number[];
  scale?: readonly number[];
}>;

type GltfMaterial = Readonly<{
  alphaMode?: string;
  doubleSided?: boolean;
  pbrMetallicRoughness?: Readonly<{ baseColorFactor?: readonly number[] }>;
}>;

type GltfDocument = Readonly<{
  asset?: Readonly<{ version?: string }>;
  accessors?: readonly GltfAccessor[];
  bufferViews?: readonly GltfBufferView[];
  meshes?: readonly GltfMesh[];
  nodes?: readonly GltfNode[];
  scenes?: readonly Readonly<{ nodes?: readonly number[] }>[];
  scene?: number;
  materials?: readonly GltfMaterial[];
}>;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row]! * b[column * 4]!
        + a[4 + row]! * b[column * 4 + 1]!
        + a[8 + row]! * b[column * 4 + 2]!
        + a[12 + row]! * b[column * 4 + 3]!;
    }
  }
  return out;
}

function translation(x: number, y: number, z: number): number[] {
  const out = identity();
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

function scaling(x: number, y: number, z: number): number[] {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

function quaternionMatrix(x: number, y: number, z: number, w: number): number[] {
  const xx = x * x; const yy = y * y; const zz = z * z;
  const xy = x * y; const xz = x * z; const yz = y * z;
  const wx = w * x; const wy = w * y; const wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
    0, 0, 0, 1
  ];
}

function nodeMatrix(node: GltfNode): number[] {
  if (node.matrix?.length === 16) return Array.from(node.matrix, Number);
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  return multiply(
    multiply(
      translation(Number(t[0] ?? 0), Number(t[1] ?? 0), Number(t[2] ?? 0)),
      quaternionMatrix(Number(r[0] ?? 0), Number(r[1] ?? 0), Number(r[2] ?? 0), Number(r[3] ?? 1))
    ),
    scaling(Number(s[0] ?? 1), Number(s[1] ?? 1), Number(s[2] ?? 1))
  );
}

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length < 1e-9) return [0, 1, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function transformPoint(matrix: Mat4, point: Vec3): Vec3 {
  return [
    matrix[0]! * point[0] + matrix[4]! * point[1] + matrix[8]! * point[2] + matrix[12]!,
    matrix[1]! * point[0] + matrix[5]! * point[1] + matrix[9]! * point[2] + matrix[13]!,
    matrix[2]! * point[0] + matrix[6]! * point[1] + matrix[10]! * point[2] + matrix[14]!
  ];
}

function normalColumns(matrix: Mat4): readonly [Vec3, Vec3, Vec3] {
  const c0: Vec3 = [matrix[0]!, matrix[1]!, matrix[2]!];
  const c1: Vec3 = [matrix[4]!, matrix[5]!, matrix[6]!];
  const c2: Vec3 = [matrix[8]!, matrix[9]!, matrix[10]!];
  const determinant = dot(c0, cross(c1, c2));
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) {
    throw new Error("Transformação GLB degenerada para cálculo de normais.");
  }
  const inverse = 1 / determinant;
  const n0 = cross(c1, c2).map((value) => value * inverse) as unknown as Vec3;
  const n1 = cross(c2, c0).map((value) => value * inverse) as unknown as Vec3;
  const n2 = cross(c0, c1).map((value) => value * inverse) as unknown as Vec3;
  return [n0, n1, n2];
}

function transformNormal(columns: readonly [Vec3, Vec3, Vec3], normal: Vec3): Vec3 {
  return normalize([
    columns[0][0] * normal[0] + columns[1][0] * normal[1] + columns[2][0] * normal[2],
    columns[0][1] * normal[0] + columns[1][1] * normal[1] + columns[2][1] * normal[2],
    columns[0][2] * normal[0] + columns[1][2] * normal[1] + columns[2][2] * normal[2]
  ]);
}

function parseGlb(buffer: ArrayBuffer): { document: GltfDocument; bin: Uint8Array } {
  if (buffer.byteLength < 20) throw new Error("GLB incompleto.");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Assinatura GLB inválida.");
  if (view.getUint32(4, true) !== 2) throw new Error("Somente GLB 2.0 é suportado.");
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error("Comprimento GLB inconsistente.");

  let offset = 12;
  let document: GltfDocument | null = null;
  let bin = new Uint8Array(0);
  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + chunkLength > buffer.byteLength) throw new Error("Chunk GLB inválido.");
    const chunk = new Uint8Array(buffer, offset, chunkLength);
    if (chunkType === GLB_JSON_CHUNK && !document) {
      const text = new TextDecoder().decode(chunk).replace(/[\u0000\u0020]+$/g, "");
      document = JSON.parse(text) as GltfDocument;
    } else if (chunkType === GLB_BIN_CHUNK && bin.byteLength === 0) {
      bin = new Uint8Array(chunk);
    }
    offset += chunkLength;
  }
  if (!document || document.asset?.version !== "2.0") throw new Error("Documento glTF 2.0 ausente.");
  return { document, bin };
}

function accessorOffset(document: GltfDocument, accessor: GltfAccessor): { offset: number; stride: number } {
  if (accessor.bufferView === undefined) throw new Error("Accessor sem bufferView não suportado.");
  const view = document.bufferViews?.[accessor.bufferView];
  if (!view || view.buffer !== 0) throw new Error("Apenas BIN incorporado é suportado.");
  return {
    offset: Number(view.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0),
    stride: Number(view.byteStride ?? 0)
  };
}

function readFloatVec3(document: GltfDocument, bin: Uint8Array, accessorIndex: number, semantic: string): Float32Array {
  const accessor = document.accessors?.[accessorIndex];
  if (!accessor || accessor.componentType !== 5126 || accessor.type !== "VEC3") {
    throw new Error(`${semantic} precisa ser FLOAT VEC3.`);
  }
  const { offset, stride } = accessorOffset(document, accessor);
  const itemStride = stride || 12;
  if (offset + itemStride * Math.max(0, accessor.count - 1) + 12 > bin.byteLength) {
    throw new Error(`${semantic} fora do buffer.`);
  }
  const source = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const output = new Float32Array(accessor.count * 3);
  for (let index = 0; index < accessor.count; index += 1) {
    const base = offset + index * itemStride;
    const x = source.getFloat32(base, true);
    const y = source.getFloat32(base + 4, true);
    const z = source.getFloat32(base + 8, true);
    if (![x, y, z].every(Number.isFinite)) throw new Error(`${semantic} contém número não finito.`);
    output[index * 3] = x;
    output[index * 3 + 1] = y;
    output[index * 3 + 2] = z;
  }
  return output;
}

function componentByteSize(componentType: number): number {
  if (componentType === 5121) return 1;
  if (componentType === 5123) return 2;
  if (componentType === 5125) return 4;
  throw new Error("Tipo de índice GLB não suportado.");
}

function readIndices(document: GltfDocument, bin: Uint8Array, accessorIndex: number): Uint32Array {
  const accessor = document.accessors?.[accessorIndex];
  if (!accessor || accessor.type !== "SCALAR") throw new Error("Índices precisam ser SCALAR.");
  const { offset, stride } = accessorOffset(document, accessor);
  const bytes = componentByteSize(accessor.componentType);
  const itemStride = stride || bytes;
  if (offset + itemStride * Math.max(0, accessor.count - 1) + bytes > bin.byteLength) throw new Error("Índices fora do buffer.");
  const source = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const output = new Uint32Array(accessor.count);
  for (let index = 0; index < accessor.count; index += 1) {
    const base = offset + index * itemStride;
    output[index] = accessor.componentType === 5121
      ? source.getUint8(base)
      : accessor.componentType === 5123
        ? source.getUint16(base, true)
        : source.getUint32(base, true);
  }
  return output;
}

function expandVec3(values: Float32Array, indices: Uint32Array): Float32Array {
  const expanded = new Float32Array(indices.length * 3);
  for (let index = 0; index < indices.length; index += 1) {
    const sourceOffset = indices[index]! * 3;
    if (sourceOffset + 2 >= values.length) throw new Error("Índice GLB referencia atributo inexistente.");
    const targetOffset = index * 3;
    expanded[targetOffset] = values[sourceOffset]!;
    expanded[targetOffset + 1] = values[sourceOffset + 1]!;
    expanded[targetOffset + 2] = values[sourceOffset + 2]!;
  }
  return expanded;
}

function flatNormals(positions: Float32Array): Float32Array {
  if (positions.length % 9 !== 0) throw new Error("TRIANGLES precisa conter múltiplos de três vértices.");
  const normals = new Float32Array(positions.length);
  for (let offset = 0; offset < positions.length; offset += 9) {
    const a: Vec3 = [positions[offset]!, positions[offset + 1]!, positions[offset + 2]!];
    const b: Vec3 = [positions[offset + 3]!, positions[offset + 4]!, positions[offset + 5]!];
    const c: Vec3 = [positions[offset + 6]!, positions[offset + 7]!, positions[offset + 8]!];
    const normal = normalize(cross(subtract(b, a), subtract(c, a)));
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const base = offset + vertex * 3;
      normals[base] = normal[0]; normals[base + 1] = normal[1]; normals[base + 2] = normal[2];
    }
  }
  return normals;
}

function material(document: GltfDocument, materialIndex?: number): Readonly<{
  color: readonly [number, number, number, number];
  doubleSided: boolean;
}> {
  const value = materialIndex === undefined ? undefined : document.materials?.[materialIndex];
  if (value?.alphaMode && value.alphaMode !== "OPAQUE") {
    throw new Error(`Material alphaMode=${value.alphaMode} ainda não pertence ao perfil lit seguro.`);
  }
  const factor = value?.pbrMetallicRoughness?.baseColorFactor;
  const raw = [factor?.[0] ?? 0.44, factor?.[1] ?? 0.76, factor?.[2] ?? 0.64, factor?.[3] ?? 1].map(Number);
  if (raw.length !== 4 || raw.some((item) => !Number.isFinite(item) || item < 0 || item > 1)) {
    throw new Error("baseColorFactor precisa conter quatro valores finitos entre 0 e 1.");
  }
  return {
    color: [raw[0]!, raw[1]!, raw[2]!, raw[3]!],
    doubleSided: value?.doubleSided === true
  };
}

function normalizeBounds(drawables: readonly LitDrawable[]): LitDrawable[] {
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (const drawable of drawables) {
    for (let index = 0; index < drawable.positions.length; index += 3) {
      const x = drawable.positions[index]!; const y = drawable.positions[index + 1]!; const z = drawable.positions[index + 2]!;
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!Number.isFinite(extent) || extent <= 0) throw new Error("GLB com bounds degenerados.");
  const center: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const scale = 1.55 / extent;
  return drawables.map((drawable) => {
    const positions = new Float32Array(drawable.positions.length);
    for (let index = 0; index < positions.length; index += 3) {
      positions[index] = (drawable.positions[index]! - center[0]) * scale;
      positions[index + 1] = (drawable.positions[index + 1]! - center[1]) * scale;
      positions[index + 2] = (drawable.positions[index + 2]! - center[2]) * scale;
    }
    return { ...drawable, positions };
  });
}

export function parseLitGlb(buffer: ArrayBuffer): LitGlbModel {
  const { document, bin } = parseGlb(buffer);
  const meshes = document.meshes ?? [];
  const nodes = document.nodes ?? [];
  const scene = document.scenes?.[document.scene ?? 0] ?? document.scenes?.[0];
  const roots = scene?.nodes ?? nodes.map((_, index) => index);
  const drawables: LitDrawable[] = [];
  const visited = new Set<number>();
  let explicitNormalPrimitives = 0;
  let fallbackNormalPrimitives = 0;

  const visit = (nodeIndex: number, parent: Mat4) => {
    if (visited.has(nodeIndex)) return;
    const node = nodes[nodeIndex];
    if (!node) return;
    visited.add(nodeIndex);
    const world = multiply(parent, nodeMatrix(node));
    const normalMatrix = normalColumns(world);

    if (node.mesh !== undefined) {
      const mesh = meshes[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        if ((primitive.mode ?? 4) !== 4) throw new Error("Renderer lit aceita somente TRIANGLES.");
        const positionAccessor = primitive.attributes?.POSITION;
        if (positionAccessor === undefined) throw new Error("Primitiva GLB sem POSITION.");
        const positionsSource = readFloatVec3(document, bin, positionAccessor, "POSITION");
        const transformed = new Float32Array(positionsSource.length);
        for (let index = 0; index < positionsSource.length; index += 3) {
          const point = transformPoint(world, [positionsSource[index]!, positionsSource[index + 1]!, positionsSource[index + 2]!]);
          transformed[index] = point[0]; transformed[index + 1] = point[1]; transformed[index + 2] = point[2];
        }

        const indices = primitive.indices === undefined ? null : readIndices(document, bin, primitive.indices);
        const positions = indices ? expandVec3(transformed, indices) : transformed;
        if (positions.length % 9 !== 0) throw new Error("Primitiva TRIANGLES possui quantidade inválida de vértices.");

        let normals: Float32Array;
        let normalSource: LitDrawable["normalSource"];
        const normalAccessor = primitive.attributes?.NORMAL;
        if (normalAccessor !== undefined) {
          const rawNormals = readFloatVec3(document, bin, normalAccessor, "NORMAL");
          if (rawNormals.length !== positionsSource.length) throw new Error("NORMAL precisa ter o mesmo count de POSITION.");
          const transformedNormals = new Float32Array(rawNormals.length);
          for (let index = 0; index < rawNormals.length; index += 3) {
            const normal = transformNormal(normalMatrix, [rawNormals[index]!, rawNormals[index + 1]!, rawNormals[index + 2]!]);
            transformedNormals[index] = normal[0]; transformedNormals[index + 1] = normal[1]; transformedNormals[index + 2] = normal[2];
          }
          normals = indices ? expandVec3(transformedNormals, indices) : transformedNormals;
          normalSource = "accessor";
          explicitNormalPrimitives += 1;
        } else {
          normals = flatNormals(positions);
          normalSource = "flat-fallback";
          fallbackNormalPrimitives += 1;
        }

        const appearance = material(document, primitive.material);
        drawables.push({ positions, normals, color: appearance.color, doubleSided: appearance.doubleSided, normalSource });
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };

  for (const root of roots) visit(root, identity());
  if (drawables.length === 0) throw new Error("GLB sem malha renderizável.");
  return {
    drawables: normalizeBounds(drawables),
    explicitNormalPrimitives,
    fallbackNormalPrimitives
  };
}

// Tehkné Solutions
