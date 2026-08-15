import { parseLitGlb, type LitDrawable } from "./glb-lit-runtime";

export type EmbeddedTextureSampler = Readonly<{
  magFilter: 9728 | 9729;
  minFilter: 9728 | 9729 | 9984 | 9985 | 9986 | 9987;
  wrapS: 33071 | 33648 | 10497;
  wrapT: 33071 | 33648 | 10497;
}>;

export type EmbeddedBaseColorTexture = Readonly<{
  textureIndex: number;
  imageIndex: number;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Uint8Array;
  sampler: EmbeddedTextureSampler;
}>;

export type TexturedPbrDrawable = LitDrawable & Readonly<{
  metallic: number;
  roughness: number;
  emissive: readonly [number, number, number];
  texCoords: Float32Array | null;
  baseColorTexture: EmbeddedBaseColorTexture | null;
}>;

export type TexturedPbrModel = Readonly<{
  drawables: readonly TexturedPbrDrawable[];
  explicitNormalPrimitives: number;
  fallbackNormalPrimitives: number;
  metallicMaterials: number;
  emissiveMaterials: number;
  texturedMaterials: number;
  embeddedTextureBytes: number;
  materialModel: "pbr-lite-basecolor-texture-v1";
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

function factor(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error(`${label} precisa estar entre 0 e 1.`);
  return parsed;
}

function emissiveFactor(value: unknown, label: string): readonly [number, number, number] {
  if (value === undefined) return [0, 0, 0];
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} precisa conter três valores.`);
  return [
    factor(value[0], 0, `${label}[0]`),
    factor(value[1], 0, `${label}[1]`),
    factor(value[2], 0, `${label}[2]`)
  ];
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
  const accessors = array(document.accessors, "accessors").map((value, indexValue) => object(value, `accessors[${indexValue}]`));
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
  const accessors = array(document.accessors, "accessors").map((value, indexValue) => object(value, `accessors[${indexValue}]`));
  const accessor = accessors[index(accessorIndex, accessors.length, "indices") ]!;
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
    output[item] = componentType === 5121 ? source.getUint8(base) : componentType === 5123 ? source.getUint16(base, true) : source.getUint32(base, true);
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
  const views = array(document.bufferViews, "bufferViews").map((value, indexValue) => object(value, `bufferViews[${indexValue}]`));
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

function enumValue<const T extends readonly number[]>(value: unknown, allowed: T, fallback: T[number], label: string): T[number] {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!allowed.includes(parsed)) throw new Error(`${label} não pertence ao perfil de sampler seguro.`);
  return parsed as T[number];
}

function textureDescriptor(document: JsonObject, bin: Uint8Array, textureIndex: number): EmbeddedBaseColorTexture {
  const textures = array(document.textures, "textures").map((value, indexValue) => object(value, `textures[${indexValue}]`));
  const images = array(document.images, "images").map((value, indexValue) => object(value, `images[${indexValue}]`));
  const samplers = array(document.samplers, "samplers").map((value, indexValue) => object(value, `samplers[${indexValue}]`));
  const texture = textures[index(textureIndex, textures.length, "baseColorTexture.index")]!;
  if (texture.extensions !== undefined) throw new Error("Texture extensions ainda não pertencem ao runtime 23.11.");
  const imageIndex = index(texture.source, images.length, `textures[${textureIndex}].source`);
  const image = images[imageIndex]!;
  if (image.uri !== undefined) throw new Error("Texture externa/data URI é proibida; somente bufferView aprovado é aceito.");
  const mimeType = String(image.mimeType ?? "");
  if (!MIME_TYPES.includes(mimeType as typeof MIME_TYPES[number])) throw new Error(`MIME de texture não suportado: ${mimeType || "ausente"}.`);
  const viewIndex = integer(image.bufferView, `images[${imageIndex}].bufferView`);
  const sampler = texture.sampler === undefined ? null : samplers[index(texture.sampler, samplers.length, `textures[${textureIndex}].sampler`)]!;
  if (sampler?.extensions !== undefined) throw new Error("Sampler extensions ainda não pertencem ao runtime 23.11.");
  return {
    textureIndex,
    imageIndex,
    mimeType: mimeType as EmbeddedBaseColorTexture["mimeType"],
    bytes: bufferViewBytes(document, bin, viewIndex),
    sampler: {
      magFilter: enumValue(sampler?.magFilter, MAG_FILTERS, 9729, "sampler.magFilter"),
      minFilter: enumValue(sampler?.minFilter, MIN_FILTERS, 9987, "sampler.minFilter"),
      wrapS: enumValue(sampler?.wrapS, WRAPS, 10497, "sampler.wrapS"),
      wrapT: enumValue(sampler?.wrapT, WRAPS, 10497, "sampler.wrapT")
    }
  };
}

function rejectTexture(value: unknown, label: string): void {
  if (value !== undefined) throw new Error(`${label} ainda não pertence ao perfil 23.11 de baseColorTexture.`);
}

function materialProfile(document: JsonObject, bin: Uint8Array, materialIndex: number | null): Readonly<{
  metallic: number;
  roughness: number;
  emissive: readonly [number, number, number];
  baseColorTexture: EmbeddedBaseColorTexture | null;
}> {
  const materials = array(document.materials, "materials").map((value, indexValue) => object(value, `materials[${indexValue}]`));
  const material = materialIndex === null ? null : materials[materialIndex] ?? null;
  if (!material) return { metallic: 1, roughness: 1, emissive: [0, 0, 0], baseColorTexture: null };
  if (material.extensions !== undefined) throw new Error(`materials[${materialIndex}].extensions ainda não pertence ao perfil 23.11.`);
  const pbr = material.pbrMetallicRoughness === undefined ? null : object(material.pbrMetallicRoughness, `materials[${materialIndex}].pbrMetallicRoughness`);
  rejectTexture(pbr?.metallicRoughnessTexture, `materials[${materialIndex}].pbrMetallicRoughness.metallicRoughnessTexture`);
  rejectTexture(material.normalTexture, `materials[${materialIndex}].normalTexture`);
  rejectTexture(material.occlusionTexture, `materials[${materialIndex}].occlusionTexture`);
  rejectTexture(material.emissiveTexture, `materials[${materialIndex}].emissiveTexture`);

  let baseColorTexture: EmbeddedBaseColorTexture | null = null;
  if (pbr?.baseColorTexture !== undefined) {
    const info = object(pbr.baseColorTexture, `materials[${materialIndex}].pbrMetallicRoughness.baseColorTexture`);
    if (info.extensions !== undefined) throw new Error("baseColorTexture.extensions ainda não pertence ao perfil 23.11.");
    if (info.texCoord !== undefined && integer(info.texCoord, "baseColorTexture.texCoord") !== 0) throw new Error("baseColorTexture.texCoord precisa ser 0.");
    baseColorTexture = textureDescriptor(document, bin, integer(info.index, "baseColorTexture.index"));
  }

  return {
    metallic: factor(pbr?.metallicFactor, 1, `materials[${materialIndex}].metallicFactor`),
    roughness: factor(pbr?.roughnessFactor, 1, `materials[${materialIndex}].roughnessFactor`),
    emissive: emissiveFactor(material.emissiveFactor, `materials[${materialIndex}].emissiveFactor`),
    baseColorTexture
  };
}

export function parseTexturedPbrGlb(buffer: ArrayBuffer): TexturedPbrModel {
  const lit = parseLitGlb(buffer);
  const { document, bin } = parseGlb(buffer);
  const profiles = primitiveProfiles(document);
  if (profiles.length !== lit.drawables.length) throw new Error("Ordem de primitivas texturizadas não corresponde ao runtime lit.");

  let metallicMaterials = 0;
  let emissiveMaterials = 0;
  let texturedMaterials = 0;
  let embeddedTextureBytes = 0;
  const countedTextures = new Set<number>();

  const drawables = lit.drawables.map((drawable, primitiveIndex): TexturedPbrDrawable => {
    const primitive = profiles[primitiveIndex]!;
    const profile = materialProfile(document, bin, primitive.materialIndex);
    let texCoords: Float32Array | null = null;
    if (profile.baseColorTexture) {
      if (primitive.texCoordAccessor === null) throw new Error(`primitive[${primitiveIndex}] usa baseColorTexture sem TEXCOORD_0.`);
      const raw = readFloatVec2(document, bin, primitive.texCoordAccessor, `primitive[${primitiveIndex}].TEXCOORD_0`);
      texCoords = primitive.indicesAccessor === null ? raw : expandVec2(raw, readIndices(document, bin, primitive.indicesAccessor));
      if (texCoords.length / 2 !== drawable.positions.length / 3) throw new Error(`primitive[${primitiveIndex}] possui TEXCOORD_0 com count incompatível.`);
      texturedMaterials += 1;
      if (!countedTextures.has(profile.baseColorTexture.textureIndex)) {
        countedTextures.add(profile.baseColorTexture.textureIndex);
        embeddedTextureBytes += profile.baseColorTexture.bytes.byteLength;
      }
    }
    if (profile.metallic > 0.001) metallicMaterials += 1;
    if (profile.emissive.some((value) => value > 0.001)) emissiveMaterials += 1;
    return { ...drawable, ...profile, texCoords };
  });

  return {
    drawables,
    explicitNormalPrimitives: lit.explicitNormalPrimitives,
    fallbackNormalPrimitives: lit.fallbackNormalPrimitives,
    metallicMaterials,
    emissiveMaterials,
    texturedMaterials,
    embeddedTextureBytes,
    materialModel: "pbr-lite-basecolor-texture-v1"
  };
}

// Tehkné Solutions
