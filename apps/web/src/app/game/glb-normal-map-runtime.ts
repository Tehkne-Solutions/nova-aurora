import {
  parseAmbientEmissivePbrGlb,
  type AmbientEmissivePbrDrawable
} from "./glb-ambient-emissive-runtime";
import type { EmbeddedMaterialTexture } from "./glb-dual-texture-runtime";

export type NormalMappedPbrDrawable = AmbientEmissivePbrDrawable & Readonly<{
  tangents: Float32Array | null;
  normalTexture: EmbeddedMaterialTexture | null;
  normalScale: number;
}>;

export type NormalMappedPbrModel = Readonly<{
  drawables: readonly NormalMappedPbrDrawable[];
  explicitNormalPrimitives: number;
  fallbackNormalPrimitives: number;
  metallicMaterials: number;
  emissiveMaterials: number;
  baseColorTexturedMaterials: number;
  metallicRoughnessTexturedMaterials: number;
  occlusionTexturedMaterials: number;
  emissiveTexturedMaterials: number;
  normalMappedMaterials: number;
  authoredTangentPrimitives: number;
  uniqueEmbeddedTextures: number;
  embeddedTextureBytes: number;
  materialModel: "pbr-tangent-normal-map-v1";
}>;

type JsonObject = Record<string, unknown>;
type Mat4 = readonly number[];
type Vec3 = readonly [number, number, number];
type ParsedGlb = Readonly<{ document: JsonObject; bin: Uint8Array }>;
type PrimitiveProfile = Readonly<{
  materialIndex: number | null;
  tangentAccessor: number | null;
  texCoordAccessor: number | null;
  indicesAccessor: number | null;
  world: Mat4;
}>;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAG_FILTERS = [9728, 9729] as const;
const MIN_FILTERS = [9728, 9729, 9984, 9985, 9986, 9987] as const;
const WRAPS = [33071, 33648, 10497] as const;
const NORMAL_SCALE_LIMIT = 8;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} precisa ser um objeto.`);
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} precisa ser um array.`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) throw new Error(`${label} precisa ser um inteiro >= ${minimum}.`);
  return Number(value);
}

function index(value: unknown, length: number, label: string): number {
  const parsed = integer(value, label);
  if (parsed >= length) throw new Error(`${label} aponta para índice inexistente ${parsed}.`);
  return parsed;
}

function enumValue<const T extends readonly number[]>(value: unknown, allowed: T, fallback: T[number], label: string): T[number] {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!allowed.includes(parsed)) throw new Error(`${label} não pertence ao perfil de sampler seguro.`);
  return parsed as T[number];
}

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

function nodeMatrix(node: JsonObject): number[] {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix.map(Number);
  const t = Array.isArray(node.translation) ? node.translation : [0, 0, 0];
  const r = Array.isArray(node.rotation) ? node.rotation : [0, 0, 0, 1];
  const s = Array.isArray(node.scale) ? node.scale : [1, 1, 1];
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
  if (!Number.isFinite(length) || length < 1e-9) throw new Error("TANGENT transformado degenerou.");
  return [value[0] / length, value[1] / length, value[2] / length];
}

function determinantSign(matrix: Mat4): number {
  const a00 = matrix[0]!; const a01 = matrix[4]!; const a02 = matrix[8]!;
  const a10 = matrix[1]!; const a11 = matrix[5]!; const a12 = matrix[9]!;
  const a20 = matrix[2]!; const a21 = matrix[6]!; const a22 = matrix[10]!;
  const determinant =
    a00 * (a11 * a22 - a12 * a21)
    - a01 * (a10 * a22 - a12 * a20)
    + a02 * (a10 * a21 - a11 * a20);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) throw new Error("Transformação GLB degenerada para TANGENT.");
  return determinant < 0 ? -1 : 1;
}

function transformTangent(matrix: Mat4, tangent: Vec3): Vec3 {
  return normalize([
    matrix[0]! * tangent[0] + matrix[4]! * tangent[1] + matrix[8]! * tangent[2],
    matrix[1]! * tangent[0] + matrix[5]! * tangent[1] + matrix[9]! * tangent[2],
    matrix[2]! * tangent[0] + matrix[6]! * tangent[1] + matrix[10]! * tangent[2]
  ]);
}

function parseGlb(buffer: ArrayBuffer): ParsedGlb {
  if (buffer.byteLength < 20) throw new Error("GLB incompleto.");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Assinatura GLB inválida.");
  if (view.getUint32(4, true) !== 2) throw new Error("Somente GLB 2.0 é suportado.");
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error("Comprimento GLB inconsistente.");

  let offset = 12;
  let document: JsonObject | null = null;
  let bin = new Uint8Array(0);
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > buffer.byteLength) throw new Error("Chunk GLB inválido.");
    const chunk = new Uint8Array(buffer, offset, length);
    if (type === GLB_JSON_CHUNK && !document) {
      const text = new TextDecoder().decode(chunk).replace(/[\u0000\u0020]+$/g, "");
      document = object(JSON.parse(text), "Documento glTF");
    } else if (type === GLB_BIN_CHUNK && bin.byteLength === 0) {
      bin = new Uint8Array(chunk);
    }
    offset += length;
  }
  if (!document || object(document.asset, "asset").version !== "2.0") throw new Error("Documento glTF 2.0 ausente.");
  return { document, bin };
}

function paddedLength(length: number): number {
  return length + ((4 - length % 4) % 4);
}

function buildSanitizedGlb(document: JsonObject, bin: Uint8Array): ArrayBuffer {
  const clone = JSON.parse(JSON.stringify(document)) as JsonObject;
  for (const [materialIndex, rawMaterial] of array(clone.materials, "materials").entries()) {
    delete object(rawMaterial, `materials[${materialIndex}]`).normalTexture;
  }
  const rawJson = new TextEncoder().encode(JSON.stringify(clone));
  const jsonLength = paddedLength(rawJson.byteLength);
  const binLength = paddedLength(bin.byteLength);
  const totalLength = 12 + 8 + jsonLength + (binLength > 0 ? 8 + binLength : 0);
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, GLB_JSON_CHUNK, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(rawJson, 20);
  if (binLength > 0) {
    const chunkOffset = 20 + jsonLength;
    view.setUint32(chunkOffset, binLength, true);
    view.setUint32(chunkOffset + 4, GLB_BIN_CHUNK, true);
    output.set(bin, chunkOffset + 8);
  }
  return output.buffer;
}

function accessorOffset(document: JsonObject, accessor: JsonObject): Readonly<{ offset: number; stride: number }> {
  const views = array(document.bufferViews, "bufferViews").map((value, position) => object(value, `bufferViews[${position}]`));
  const viewIndex = index(accessor.bufferView, views.length, "accessor.bufferView");
  const view = views[viewIndex]!;
  if (integer(view.buffer, `bufferViews[${viewIndex}].buffer`) !== 0) throw new Error("Apenas BIN incorporado é suportado.");
  return { offset: Number(view.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0), stride: Number(view.byteStride ?? 0) };
}

function readFloatVec2(document: JsonObject, bin: Uint8Array, accessorIndex: number, label: string): Float32Array {
  const accessors = array(document.accessors, "accessors").map((value, position) => object(value, `accessors[${position}]`));
  const accessor = accessors[index(accessorIndex, accessors.length, label)]!;
  if (Number(accessor.componentType) !== 5126 || accessor.type !== "VEC2") throw new Error(`${label} precisa ser FLOAT VEC2.`);
  const count = integer(accessor.count, `${label}.count`, 1);
  const { offset, stride } = accessorOffset(document, accessor);
  const itemStride = stride || 8;
  if (offset + itemStride * Math.max(0, count - 1) + 8 > bin.byteLength) throw new Error(`${label} fora do buffer.`);
  const source = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const output = new Float32Array(count * 2);
  for (let item = 0; item < count; item += 1) {
    const base = offset + item * itemStride;
    const u = source.getFloat32(base, true);
    const v = source.getFloat32(base + 4, true);
    if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error(`${label} contém número não finito.`);
    output[item * 2] = u;
    output[item * 2 + 1] = v;
  }
  return output;
}

function readFloatVec4(document: JsonObject, bin: Uint8Array, accessorIndex: number, label: string): Float32Array {
  const accessors = array(document.accessors, "accessors").map((value, position) => object(value, `accessors[${position}]`));
  const accessor = accessors[index(accessorIndex, accessors.length, label)]!;
  if (Number(accessor.componentType) !== 5126 || accessor.type !== "VEC4") throw new Error(`${label} precisa ser FLOAT VEC4.`);
  const count = integer(accessor.count, `${label}.count`, 1);
  const { offset, stride } = accessorOffset(document, accessor);
  const itemStride = stride || 16;
  if (offset + itemStride * Math.max(0, count - 1) + 16 > bin.byteLength) throw new Error(`${label} fora do buffer.`);
  const source = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const output = new Float32Array(count * 4);
  for (let item = 0; item < count; item += 1) {
    const base = offset + item * itemStride;
    for (let component = 0; component < 4; component += 1) {
      const value = source.getFloat32(base + component * 4, true);
      if (!Number.isFinite(value)) throw new Error(`${label} contém número não finito.`);
      output[item * 4 + component] = value;
    }
  }
  return output;
}

function readIndices(document: JsonObject, bin: Uint8Array, accessorIndex: number): Uint32Array {
  const accessors = array(document.accessors, "accessors").map((value, position) => object(value, `accessors[${position}]`));
  const accessor = accessors[index(accessorIndex, accessors.length, "indices")]!;
  if (accessor.type !== "SCALAR") throw new Error("Índices precisam ser SCALAR.");
  const componentType = Number(accessor.componentType);
  const bytes = componentType === 5121 ? 1 : componentType === 5123 ? 2 : componentType === 5125 ? 4 : 0;
  if (!bytes) throw new Error("Tipo de índice GLB não suportado.");
  const count = integer(accessor.count, "indices.count", 1);
  const { offset, stride } = accessorOffset(document, accessor);
  const itemStride = stride || bytes;
  if (offset + itemStride * Math.max(0, count - 1) + bytes > bin.byteLength) throw new Error("Índices fora do buffer.");
  const source = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const output = new Uint32Array(count);
  for (let item = 0; item < count; item += 1) {
    const base = offset + item * itemStride;
    output[item] = componentType === 5121
      ? source.getUint8(base)
      : componentType === 5123
        ? source.getUint16(base, true)
        : source.getUint32(base, true);
  }
  return output;
}

function expandVec2(values: Float32Array, indices: Uint32Array): Float32Array {
  const expanded = new Float32Array(indices.length * 2);
  for (let item = 0; item < indices.length; item += 1) {
    const sourceOffset = indices[item]! * 2;
    if (sourceOffset + 1 >= values.length) throw new Error("Índice GLB referencia TEXCOORD_0 inexistente.");
    expanded[item * 2] = values[sourceOffset]!;
    expanded[item * 2 + 1] = values[sourceOffset + 1]!;
  }
  return expanded;
}

function expandVec4(values: Float32Array, indices: Uint32Array): Float32Array {
  const expanded = new Float32Array(indices.length * 4);
  for (let item = 0; item < indices.length; item += 1) {
    const sourceOffset = indices[item]! * 4;
    if (sourceOffset + 3 >= values.length) throw new Error("Índice GLB referencia TANGENT inexistente.");
    const targetOffset = item * 4;
    expanded[targetOffset] = values[sourceOffset]!;
    expanded[targetOffset + 1] = values[sourceOffset + 1]!;
    expanded[targetOffset + 2] = values[sourceOffset + 2]!;
    expanded[targetOffset + 3] = values[sourceOffset + 3]!;
  }
  return expanded;
}

function transformedTangents(raw: Float32Array, world: Mat4): Float32Array {
  const output = new Float32Array(raw.length);
  const reflection = determinantSign(world);
  for (let offset = 0; offset < raw.length; offset += 4) {
    const transformed = transformTangent(world, [raw[offset]!, raw[offset + 1]!, raw[offset + 2]!]);
    output[offset] = transformed[0];
    output[offset + 1] = transformed[1];
    output[offset + 2] = transformed[2];
    output[offset + 3] = raw[offset + 3]! * reflection;
  }
  return output;
}

function bufferViewBytes(document: JsonObject, bin: Uint8Array, viewIndex: number): Uint8Array {
  const views = array(document.bufferViews, "bufferViews").map((value, position) => object(value, `bufferViews[${position}]`));
  const view = views[index(viewIndex, views.length, "image.bufferView")]!;
  if (integer(view.buffer, `bufferViews[${viewIndex}].buffer`) !== 0) throw new Error("Imagem precisa usar BIN 0.");
  const byteOffset = Number(view.byteOffset ?? 0);
  const byteLength = integer(view.byteLength, `bufferViews[${viewIndex}].byteLength`, 1);
  if (byteOffset + byteLength > bin.byteLength) throw new Error("Imagem embutida ultrapassa BIN.");
  return bin.slice(byteOffset, byteOffset + byteLength);
}

function textureDescriptor(document: JsonObject, bin: Uint8Array, textureIndex: number): EmbeddedMaterialTexture {
  const textures = array(document.textures, "textures").map((value, position) => object(value, `textures[${position}]`));
  const images = array(document.images, "images").map((value, position) => object(value, `images[${position}]`));
  const samplers = array(document.samplers, "samplers").map((value, position) => object(value, `samplers[${position}]`));
  const texture = textures[index(textureIndex, textures.length, "normalTexture.index")]!;
  if (texture.extensions !== undefined) throw new Error("normalTexture texture extensions ainda não pertencem ao runtime 23.14.");
  const imageIndex = index(texture.source, images.length, `textures[${textureIndex}].source`);
  const image = images[imageIndex]!;
  if (image.uri !== undefined) throw new Error("Texture externa/data URI é proibida; somente bufferView aprovado é aceito.");
  const mimeType = String(image.mimeType ?? "");
  if (!MIME_TYPES.includes(mimeType as typeof MIME_TYPES[number])) throw new Error(`MIME de normalTexture não suportado: ${mimeType || "ausente"}.`);
  const viewIndex = integer(image.bufferView, `images[${imageIndex}].bufferView`);
  const sampler = texture.sampler === undefined ? null : samplers[index(texture.sampler, samplers.length, `textures[${textureIndex}].sampler`)]!;
  return {
    textureIndex,
    imageIndex,
    mimeType: mimeType as EmbeddedMaterialTexture["mimeType"],
    bytes: bufferViewBytes(document, bin, viewIndex),
    sampler: {
      magFilter: enumValue(sampler?.magFilter, MAG_FILTERS, 9729, "sampler.magFilter"),
      minFilter: enumValue(sampler?.minFilter, MIN_FILTERS, 9987, "sampler.minFilter"),
      wrapS: enumValue(sampler?.wrapS, WRAPS, 10497, "sampler.wrapS"),
      wrapT: enumValue(sampler?.wrapT, WRAPS, 10497, "sampler.wrapT")
    }
  };
}

function primitiveProfiles(document: JsonObject): PrimitiveProfile[] {
  const nodes = array(document.nodes, "nodes").map((value, position) => object(value, `nodes[${position}]`));
  const meshes = array(document.meshes, "meshes").map((value, position) => object(value, `meshes[${position}]`));
  const scenes = array(document.scenes, "scenes").map((value, position) => object(value, `scenes[${position}]`));
  const sceneIndex = document.scene === undefined ? 0 : Number(document.scene);
  const scene = scenes[sceneIndex] ?? scenes[0];
  const roots = scene ? array(scene.nodes, `scenes[${sceneIndex}].nodes`).map(Number) : nodes.map((_, position) => position);
  const visited = new Set<number>();
  const output: PrimitiveProfile[] = [];

  const visit = (nodeIndex: number, parent: Mat4) => {
    if (visited.has(nodeIndex)) return;
    const node = nodes[nodeIndex];
    if (!node) return;
    visited.add(nodeIndex);
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = meshes[Number(node.mesh)];
      for (const [primitiveIndex, rawPrimitive] of array(mesh?.primitives, `meshes[${String(node.mesh)}].primitives`).entries()) {
        const primitive = object(rawPrimitive, `meshes[${String(node.mesh)}].primitives[${primitiveIndex}]`);
        const attributes = object(primitive.attributes, `primitive[${primitiveIndex}].attributes`);
        output.push({
          materialIndex: primitive.material === undefined ? null : Number(primitive.material),
          tangentAccessor: attributes.TANGENT === undefined ? null : Number(attributes.TANGENT),
          texCoordAccessor: attributes.TEXCOORD_0 === undefined ? null : Number(attributes.TEXCOORD_0),
          indicesAccessor: primitive.indices === undefined ? null : Number(primitive.indices),
          world
        });
      }
    }
    for (const child of array(node.children, `nodes[${nodeIndex}].children`)) visit(Number(child), world);
  };
  for (const root of roots) visit(root, identity());
  return output;
}

function normalMap(document: JsonObject, bin: Uint8Array, materialIndex: number | null): Readonly<{ texture: EmbeddedMaterialTexture; scale: number } | null> {
  if (materialIndex === null) return null;
  const materials = array(document.materials, "materials").map((value, position) => object(value, `materials[${position}]`));
  const material = materials[materialIndex];
  if (!material || material.normalTexture === undefined) return null;
  const info = object(material.normalTexture, `materials[${materialIndex}].normalTexture`);
  if (info.extensions !== undefined) throw new Error("normalTexture.extensions ainda não pertence ao perfil 23.14.");
  if (info.texCoord !== undefined && integer(info.texCoord, "normalTexture.texCoord") !== 0) throw new Error("normalTexture.texCoord precisa ser 0.");
  const scale = info.scale === undefined ? 1 : Number(info.scale);
  if (!Number.isFinite(scale) || Math.abs(scale) > NORMAL_SCALE_LIMIT) {
    throw new Error(`normalTexture.scale precisa ser finito entre -${NORMAL_SCALE_LIMIT} e ${NORMAL_SCALE_LIMIT}.`);
  }
  return { texture: textureDescriptor(document, bin, integer(info.index, "normalTexture.index")), scale };
}

export function parseNormalMappedPbrGlb(buffer: ArrayBuffer): NormalMappedPbrModel {
  const { document, bin } = parseGlb(buffer);
  const base = parseAmbientEmissivePbrGlb(buildSanitizedGlb(document, bin));
  const profiles = primitiveProfiles(document);
  if (profiles.length !== base.drawables.length) throw new Error("Ordem de primitivas não corresponde ao runtime normal-map.");

  let normalMappedMaterials = 0;
  let authoredTangentPrimitives = 0;
  const uniqueTextures = new Map<number, number>();
  for (const drawable of base.drawables) {
    for (const descriptor of [drawable.baseColorTexture, drawable.metallicRoughnessTexture, drawable.occlusionTexture, drawable.emissiveTexture]) {
      if (descriptor) uniqueTextures.set(descriptor.textureIndex, descriptor.bytes.byteLength);
    }
  }

  const drawables = base.drawables.map((drawable, primitiveIndex): NormalMappedPbrDrawable => {
    const profile = profiles[primitiveIndex]!;
    const mapped = normalMap(document, bin, profile.materialIndex);
    if (!mapped) return { ...drawable, tangents: null, normalTexture: null, normalScale: 1 };
    if (drawable.normalSource !== "accessor") throw new Error(`primitive[${primitiveIndex}] usa normalTexture sem NORMAL authored.`);
    if (profile.tangentAccessor === null) throw new Error(`primitive[${primitiveIndex}] usa normalTexture sem TANGENT authored certificado.`);
    if (profile.texCoordAccessor === null) throw new Error(`primitive[${primitiveIndex}] usa normalTexture sem TEXCOORD_0.`);

    let texCoords = drawable.texCoords;
    if (!texCoords) {
      const rawTexCoords = readFloatVec2(document, bin, profile.texCoordAccessor, `primitive[${primitiveIndex}].TEXCOORD_0`);
      texCoords = profile.indicesAccessor === null
        ? rawTexCoords
        : expandVec2(rawTexCoords, readIndices(document, bin, profile.indicesAccessor));
    }
    if (texCoords.length / 2 !== drawable.positions.length / 3) throw new Error(`primitive[${primitiveIndex}] possui TEXCOORD_0 com count incompatível.`);

    const rawTangents = readFloatVec4(document, bin, profile.tangentAccessor, `primitive[${primitiveIndex}].TANGENT`);
    const transformed = transformedTangents(rawTangents, profile.world);
    const tangents = profile.indicesAccessor === null ? transformed : expandVec4(transformed, readIndices(document, bin, profile.indicesAccessor));
    if (tangents.length / 4 !== drawable.positions.length / 3) throw new Error(`primitive[${primitiveIndex}] possui TANGENT com count incompatível.`);

    normalMappedMaterials += 1;
    authoredTangentPrimitives += 1;
    uniqueTextures.set(mapped.texture.textureIndex, mapped.texture.bytes.byteLength);
    return { ...drawable, texCoords, tangents, normalTexture: mapped.texture, normalScale: mapped.scale };
  });

  return {
    drawables,
    explicitNormalPrimitives: base.explicitNormalPrimitives,
    fallbackNormalPrimitives: base.fallbackNormalPrimitives,
    metallicMaterials: base.metallicMaterials,
    emissiveMaterials: base.emissiveMaterials,
    baseColorTexturedMaterials: base.baseColorTexturedMaterials,
    metallicRoughnessTexturedMaterials: base.metallicRoughnessTexturedMaterials,
    occlusionTexturedMaterials: base.occlusionTexturedMaterials,
    emissiveTexturedMaterials: base.emissiveTexturedMaterials,
    normalMappedMaterials,
    authoredTangentPrimitives,
    uniqueEmbeddedTextures: uniqueTextures.size,
    embeddedTextureBytes: Array.from(uniqueTextures.values()).reduce((total, bytes) => total + bytes, 0),
    materialModel: "pbr-tangent-normal-map-v1"
  };
}

// Tehkné Solutions
