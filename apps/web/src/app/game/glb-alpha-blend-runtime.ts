import {
  parseAlphaMaskPbrGlb,
  type AlphaMaskPbrDrawable
} from "./glb-alpha-mask-runtime";

export type AlphaBlendMode = "OPAQUE" | "MASK" | "BLEND";
export type BlendCentroid = readonly [number, number, number];

export type AlphaBlendPbrDrawable = Omit<AlphaMaskPbrDrawable, "alphaMode"> & Readonly<{
  alphaMode: AlphaBlendMode;
  centroid: BlendCentroid;
}>;

export type AlphaBlendPbrModel = Readonly<{
  drawables: readonly AlphaBlendPbrDrawable[];
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
  alphaMaskedMaterials: number;
  opaqueMaterials: number;
  alphaBlendedMaterials: number;
  uniqueEmbeddedTextures: number;
  embeddedTextureBytes: number;
  materialModel: "pbr-alpha-blend-v1";
}>;

type JsonObject = Record<string, unknown>;
type ParsedGlb = Readonly<{ document: JsonObject; bin: Uint8Array }>;
type PrimitiveProfile = Readonly<{ materialIndex: number | null }>;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

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
    const material = object(rawMaterial, `materials[${materialIndex}]`);
    if (material.alphaMode !== undefined) material.alphaMode = "OPAQUE";
    delete material.alphaCutoff;
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

function primitiveProfiles(document: JsonObject): PrimitiveProfile[] {
  const nodes = array(document.nodes, "nodes").map((value, position) => object(value, `nodes[${position}]`));
  const meshes = array(document.meshes, "meshes").map((value, position) => object(value, `meshes[${position}]`));
  const scenes = array(document.scenes, "scenes").map((value, position) => object(value, `scenes[${position}]`));
  const sceneIndex = document.scene === undefined ? 0 : Number(document.scene);
  const scene = scenes[sceneIndex] ?? scenes[0];
  const roots = scene ? array(scene.nodes, `scenes[${sceneIndex}].nodes`).map(Number) : nodes.map((_, position) => position);
  const visited = new Set<number>();
  const profiles: PrimitiveProfile[] = [];

  const visit = (nodeIndex: number) => {
    if (visited.has(nodeIndex)) return;
    const node = nodes[nodeIndex];
    if (!node) return;
    visited.add(nodeIndex);
    if (node.mesh !== undefined) {
      const meshIndex = integer(node.mesh, `nodes[${nodeIndex}].mesh`);
      const mesh = meshes[meshIndex];
      if (!mesh) throw new Error(`nodes[${nodeIndex}].mesh aponta para mesh inexistente.`);
      for (const [primitiveIndex, rawPrimitive] of array(mesh.primitives, `meshes[${meshIndex}].primitives`).entries()) {
        const primitive = object(rawPrimitive, `meshes[${meshIndex}].primitives[${primitiveIndex}]`);
        profiles.push({ materialIndex: primitive.material === undefined ? null : integer(primitive.material, `meshes[${meshIndex}].primitives[${primitiveIndex}].material`) });
      }
    }
    for (const child of array(node.children, `nodes[${nodeIndex}].children`)) visit(integer(child, `nodes[${nodeIndex}].children[]`));
  };

  for (const root of roots) visit(integer(root, "scene.nodes[]"));
  return profiles;
}

function materialAlpha(document: JsonObject, materialIndex: number | null): Readonly<{ alphaMode: AlphaBlendMode; alphaCutoff: number }> {
  if (materialIndex === null) return { alphaMode: "OPAQUE", alphaCutoff: 0.5 };
  const materials = array(document.materials, "materials").map((value, position) => object(value, `materials[${position}]`));
  const material = materials[materialIndex];
  if (!material) throw new Error(`Material ${materialIndex} inexistente.`);
  const mode = String(material.alphaMode ?? "OPAQUE");
  if (mode !== "OPAQUE" && mode !== "MASK" && mode !== "BLEND") {
    throw new Error(`materials[${materialIndex}].alphaMode inválido: ${mode}.`);
  }
  if (mode !== "MASK") return { alphaMode: mode, alphaCutoff: 0.5 };
  const cutoff = material.alphaCutoff === undefined ? 0.5 : Number(material.alphaCutoff);
  if (!Number.isFinite(cutoff) || cutoff < 0) throw new Error(`materials[${materialIndex}].alphaCutoff precisa ser finito e >= 0.`);
  return { alphaMode: "MASK", alphaCutoff: cutoff };
}

function centroid(positions: Float32Array): BlendCentroid {
  if (positions.length < 3 || positions.length % 3 !== 0) throw new Error("Primitive sem posições suficientes para centroid de transparência.");
  let x = 0;
  let y = 0;
  let z = 0;
  const count = positions.length / 3;
  for (let offset = 0; offset < positions.length; offset += 3) {
    x += positions[offset]!;
    y += positions[offset + 1]!;
    z += positions[offset + 2]!;
  }
  return [x / count, y / count, z / count];
}

export function alphaBlendDepth(
  drawable: Pick<AlphaBlendPbrDrawable, "centroid">,
  rotationYDegrees: number,
  camera: BlendCentroid
): number {
  const radians = rotationYDegrees * Math.PI / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const [x, y, z] = drawable.centroid;
  const rotatedX = c * x + s * z;
  const rotatedZ = -s * x + c * z;
  const dx = rotatedX - camera[0];
  const dy = y - camera[1];
  const dz = rotatedZ - camera[2];
  return dx * dx + dy * dy + dz * dz;
}

export function parseAlphaBlendPbrGlb(buffer: ArrayBuffer): AlphaBlendPbrModel {
  const { document, bin } = parseGlb(buffer);
  const base = parseAlphaMaskPbrGlb(buildSanitizedGlb(document, bin));
  const profiles = primitiveProfiles(document);
  if (profiles.length !== base.drawables.length) throw new Error("Ordem de primitivas não corresponde ao runtime alpha-blend.");

  let alphaMaskedMaterials = 0;
  let opaqueMaterials = 0;
  let alphaBlendedMaterials = 0;
  const drawables = base.drawables.map((drawable, primitiveIndex): AlphaBlendPbrDrawable => {
    const alpha = materialAlpha(document, profiles[primitiveIndex]!.materialIndex);
    if (alpha.alphaMode === "MASK") alphaMaskedMaterials += 1;
    else if (alpha.alphaMode === "BLEND") alphaBlendedMaterials += 1;
    else opaqueMaterials += 1;
    return { ...drawable, ...alpha, centroid: centroid(drawable.positions) };
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
    normalMappedMaterials: base.normalMappedMaterials,
    authoredTangentPrimitives: base.authoredTangentPrimitives,
    alphaMaskedMaterials,
    opaqueMaterials,
    alphaBlendedMaterials,
    uniqueEmbeddedTextures: base.uniqueEmbeddedTextures,
    embeddedTextureBytes: base.embeddedTextureBytes,
    materialModel: "pbr-alpha-blend-v1"
  };
}

// Tehkné Solutions
