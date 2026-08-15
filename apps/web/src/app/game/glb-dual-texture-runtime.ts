import {
  parseTexturedPbrGlb,
  type EmbeddedBaseColorTexture,
  type TexturedPbrDrawable
} from "./glb-textured-runtime";

export type EmbeddedMaterialTexture = EmbeddedBaseColorTexture;

export type DualTexturePbrDrawable = TexturedPbrDrawable & Readonly<{
  metallicRoughnessTexture: EmbeddedMaterialTexture | null;
}>;

export type DualTexturePbrModel = Readonly<{
  drawables: readonly DualTexturePbrDrawable[];
  explicitNormalPrimitives: number;
  fallbackNormalPrimitives: number;
  metallicMaterials: number;
  emissiveMaterials: number;
  baseColorTexturedMaterials: number;
  metallicRoughnessTexturedMaterials: number;
  uniqueEmbeddedTextures: number;
  embeddedTextureBytes: number;
  materialModel: "pbr-lite-dual-texture-v2";
}>;

type JsonObject = Record<string, unknown>;
type ParsedGlb = Readonly<{ document: JsonObject; bin: Uint8Array }>;
type PrimitiveProfile = Readonly<{
  materialIndex: number | null;
  texCoordAccessor: number | null;
  indicesAccessor: number | null;
}>;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAG_FILTERS = [9728, 9729] as const;
const MIN_FILTERS = [9728, 9729, 9984, 9985, 9986, 9987] as const;
const WRAPS = [33071, 33648, 10497] as const;

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
  for (const rawMaterial of array(clone.materials, "materials")) {
    const material = object(rawMaterial, "material");
    if (material.pbrMetallicRoughness === undefined) continue;
    const pbr = object(material.pbrMetallicRoughness, "material.pbrMetallicRoughness");
    delete pbr.metallicRoughnessTexture;
  }

  const encoder = new TextEncoder();
  const rawJson = encoder.encode(JSON.stringify(clone));
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
  const views = array(document.bufferViews, "bufferViews").map((value, viewIndex) => object(value, `bufferViews[${viewIndex}]`));
  const viewIndex = index(accessor.bufferView, views.length, "accessor.bufferView");
  const view = views[viewIndex]!;
  if (integer(view.buffer, `bufferViews[${viewIndex}].buffer`) !== 0) throw new Error("Apenas BIN incorporado é suportado.");
  return {
    offset: Number(view.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0),
    stride: Number(view.byteStride ?? 0)
  };
}

function readFloatVec2(document: JsonObject, bin: Uint8Array, accessorIndex: number, label: string): Float32Array {
  const accessors = array(document.accessors, "accessors").map((value, accessorPosition) => object(value, `accessors[${accessorPosition}]`));
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

function readIndices(document: JsonObject, bin: Uint8Array, accessorIndex: number): Uint32Array {
  const accessors = array(document.accessors, "accessors").map((value, accessorPosition) => object(value, `accessors[${accessorPosition}]`));
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

function bufferViewBytes(document: JsonObject, bin: Uint8Array, viewIndex: number): Uint8Array {
  const views = array(document.bufferViews, "bufferViews").map((value, position) => object(value, `bufferViews[${position}]`));
  const view = views[index(viewIndex, views.length, "image.bufferView")]!;
  if (integer(view.buffer, `bufferViews[${viewIndex}].buffer`) !== 0) throw new Error("Imagem precisa usar BIN 0.");
  const byteOffset = Number(view.byteOffset ?? 0);
  const byteLength = integer(view.byteLength, `bufferViews[${viewIndex}].byteLength`, 1);
  if (byteOffset + byteLength > bin.byteLength) throw new Error("Imagem embutida ultrapassa BIN.");
  return bin.slice(byteOffset, byteOffset + byteLength);
}

function primitiveProfiles(document: JsonObject): PrimitiveProfile[] {
  const rawNodes = array(document.nodes, "nodes").map((value, nodeIndex) => object(value, `nodes[${nodeIndex}]`));
  const rawMeshes = array(document.meshes, "meshes").map((value, meshIndex) => object(value, `meshes[${meshIndex}]`));
  const rawScenes = array(document.scenes, "scenes").map((value, sceneIndex) => object(value, `scenes[${sceneIndex}]`));
  const sceneIndex = document.scene === undefined ? 0 : Number(document.scene);
  const scene = rawScenes[sceneIndex] ?? rawScenes[0];
  const roots = scene ? array(scene.nodes, `scenes[${sceneIndex}].nodes`).map(Number) : rawNodes.map((_, nodeIndex) => nodeIndex);
  const visited = new Set<number>();
  const order: PrimitiveProfile[] = [];

  const visit = (nodeIndex: number) => {
    if (visited.has(nodeIndex)) return;
    const node = rawNodes[nodeIndex];
    if (!node) return;
    visited.add(nodeIndex);
    if (node.mesh !== undefined) {
      const meshIndex = Number(node.mesh);
      const mesh = rawMeshes[meshIndex];
      for (const [primitiveIndex, rawPrimitive] of array(mesh?.primitives, `meshes[${meshIndex}].primitives`).entries()) {
        const primitive = object(rawPrimitive, `meshes[${meshIndex}].primitives[${primitiveIndex}]`);
        const attributes = object(primitive.attributes, `meshes[${meshIndex}].primitives[${primitiveIndex}].attributes`);
        order.push({
          materialIndex: primitive.material === undefined ? null : Number(primitive.material),
          texCoordAccessor: attributes.TEXCOORD_0 === undefined ? null : Number(attributes.TEXCOORD_0),
          indicesAccessor: primitive.indices === undefined ? null : Number(primitive.indices)
        });
      }
    }
    for (const child of array(node.children, `nodes[${nodeIndex}].children`)) visit(Number(child));
  };
  for (const root of roots) visit(root);
  return order;
}

function textureDescriptor(document: JsonObject, bin: Uint8Array, textureIndex: number): EmbeddedMaterialTexture {
  const textures = array(document.textures, "textures").map((value, position) => object(value, `textures[${position}]`));
  const images = array(document.images, "images").map((value, position) => object(value, `images[${position}]`));
  const samplers = array(document.samplers, "samplers").map((value, position) => object(value, `samplers[${position}]`));
  const texture = textures[index(textureIndex, textures.length, "metallicRoughnessTexture.index")]!;
  if (texture.extensions !== undefined) throw new Error("Texture extensions ainda não pertencem ao runtime 23.12.");
  const imageIndex = index(texture.source, images.length, `textures[${textureIndex}].source`);
  const image = images[imageIndex]!;
  if (image.uri !== undefined) throw new Error("Texture externa/data URI é proibida; somente bufferView aprovado é aceito.");
  const mimeType = String(image.mimeType ?? "");
  if (!MIME_TYPES.includes(mimeType as typeof MIME_TYPES[number])) throw new Error(`MIME de texture não suportado: ${mimeType || "ausente"}.`);
  const viewIndex = integer(image.bufferView, `images[${imageIndex}].bufferView`);
  const sampler = texture.sampler === undefined ? null : samplers[index(texture.sampler, samplers.length, `textures[${textureIndex}].sampler`)]!;
  if (sampler?.extensions !== undefined) throw new Error("Sampler extensions ainda não pertencem ao runtime 23.12.");
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

function metallicRoughnessDescriptor(document: JsonObject, bin: Uint8Array, materialIndex: number | null): EmbeddedMaterialTexture | null {
  if (materialIndex === null) return null;
  const materials = array(document.materials, "materials").map((value, position) => object(value, `materials[${position}]`));
  const material = materials[materialIndex];
  if (!material || material.pbrMetallicRoughness === undefined) return null;
  const pbr = object(material.pbrMetallicRoughness, `materials[${materialIndex}].pbrMetallicRoughness`);
  if (pbr.metallicRoughnessTexture === undefined) return null;
  const info = object(pbr.metallicRoughnessTexture, `materials[${materialIndex}].pbrMetallicRoughness.metallicRoughnessTexture`);
  if (info.extensions !== undefined) throw new Error("metallicRoughnessTexture.extensions ainda não pertence ao perfil 23.12.");
  if (info.texCoord !== undefined && integer(info.texCoord, "metallicRoughnessTexture.texCoord") !== 0) {
    throw new Error("metallicRoughnessTexture.texCoord precisa ser 0.");
  }
  return textureDescriptor(document, bin, integer(info.index, "metallicRoughnessTexture.index"));
}

export function parseDualTexturePbrGlb(buffer: ArrayBuffer): DualTexturePbrModel {
  const { document, bin } = parseGlb(buffer);
  const sanitized = buildSanitizedGlb(document, bin);
  const base = parseTexturedPbrGlb(sanitized);
  const profiles = primitiveProfiles(document);
  if (profiles.length !== base.drawables.length) throw new Error("Ordem de primitivas não corresponde ao runtime dual-texture.");

  let metallicRoughnessTexturedMaterials = 0;
  const uniqueTextures = new Map<number, number>();
  for (const drawable of base.drawables) {
    if (drawable.baseColorTexture) uniqueTextures.set(drawable.baseColorTexture.textureIndex, drawable.baseColorTexture.bytes.byteLength);
  }

  const drawables = base.drawables.map((drawable, primitiveIndex): DualTexturePbrDrawable => {
    const primitive = profiles[primitiveIndex]!;
    const metallicRoughnessTexture = metallicRoughnessDescriptor(document, bin, primitive.materialIndex);
    let texCoords = drawable.texCoords;
    if (metallicRoughnessTexture) {
      if (primitive.texCoordAccessor === null) throw new Error(`primitive[${primitiveIndex}] usa metallicRoughnessTexture sem TEXCOORD_0.`);
      if (!texCoords) {
        const raw = readFloatVec2(document, bin, primitive.texCoordAccessor, `primitive[${primitiveIndex}].TEXCOORD_0`);
        texCoords = primitive.indicesAccessor === null ? raw : expandVec2(raw, readIndices(document, bin, primitive.indicesAccessor));
      }
      if (texCoords.length / 2 !== drawable.positions.length / 3) throw new Error(`primitive[${primitiveIndex}] possui TEXCOORD_0 com count incompatível.`);
      metallicRoughnessTexturedMaterials += 1;
      uniqueTextures.set(metallicRoughnessTexture.textureIndex, metallicRoughnessTexture.bytes.byteLength);
    }
    return { ...drawable, texCoords, metallicRoughnessTexture };
  });

  return {
    drawables,
    explicitNormalPrimitives: base.explicitNormalPrimitives,
    fallbackNormalPrimitives: base.fallbackNormalPrimitives,
    metallicMaterials: base.metallicMaterials,
    emissiveMaterials: base.emissiveMaterials,
    baseColorTexturedMaterials: base.texturedMaterials,
    metallicRoughnessTexturedMaterials,
    uniqueEmbeddedTextures: uniqueTextures.size,
    embeddedTextureBytes: Array.from(uniqueTextures.values()).reduce((total, bytes) => total + bytes, 0),
    materialModel: "pbr-lite-dual-texture-v2"
  };
}

// Tehkné Solutions
