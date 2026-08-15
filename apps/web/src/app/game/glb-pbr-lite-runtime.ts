import { parseLitGlb, type LitDrawable } from "./glb-lit-runtime";

export type PbrLiteDrawable = LitDrawable & Readonly<{
  metallic: number;
  roughness: number;
  emissive: readonly [number, number, number];
}>;

export type PbrLiteModel = Readonly<{
  drawables: readonly PbrLiteDrawable[];
  explicitNormalPrimitives: number;
  fallbackNormalPrimitives: number;
  metallicMaterials: number;
  emissiveMaterials: number;
  materialModel: "pbr-lite-factors-v1";
}>;

type JsonObject = Record<string, unknown>;

const GLB_JSON_CHUNK = 0x4e4f534a;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} precisa ser um objeto.`);
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} precisa ser um array.`);
  return value;
}

function factor(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} precisa estar entre 0 e 1.`);
  return number;
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

function parseDocument(buffer: ArrayBuffer): JsonObject {
  if (buffer.byteLength < 20) throw new Error("GLB incompleto.");
  const view = new DataView(buffer);
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > buffer.byteLength) throw new Error("Chunk GLB inválido.");
    if (type === GLB_JSON_CHUNK) {
      const text = new TextDecoder().decode(new Uint8Array(buffer, offset, length)).replace(/[\u0000\u0020]+$/g, "");
      return object(JSON.parse(text), "Documento glTF");
    }
    offset += length;
  }
  throw new Error("Chunk JSON GLB ausente.");
}

function rejectTexture(value: unknown, label: string): void {
  if (value !== undefined) throw new Error(`${label} ainda não pertence ao perfil PBR-lite sem texturas.`);
}

function materialProfile(material: JsonObject | null, index: number): Readonly<{
  metallic: number;
  roughness: number;
  emissive: readonly [number, number, number];
}> {
  if (!material) return { metallic: 1, roughness: 1, emissive: [0, 0, 0] };
  if (material.extensions !== undefined) throw new Error(`materials[${index}].extensions ainda não pertence ao perfil PBR-lite.`);
  const pbr = material.pbrMetallicRoughness === undefined ? null : object(material.pbrMetallicRoughness, `materials[${index}].pbrMetallicRoughness`);
  if (pbr) {
    rejectTexture(pbr.baseColorTexture, `materials[${index}].pbrMetallicRoughness.baseColorTexture`);
    rejectTexture(pbr.metallicRoughnessTexture, `materials[${index}].pbrMetallicRoughness.metallicRoughnessTexture`);
  }
  rejectTexture(material.normalTexture, `materials[${index}].normalTexture`);
  rejectTexture(material.occlusionTexture, `materials[${index}].occlusionTexture`);
  rejectTexture(material.emissiveTexture, `materials[${index}].emissiveTexture`);
  return {
    metallic: factor(pbr?.metallicFactor, 1, `materials[${index}].metallicFactor`),
    roughness: factor(pbr?.roughnessFactor, 1, `materials[${index}].roughnessFactor`),
    emissive: emissiveFactor(material.emissiveFactor, `materials[${index}].emissiveFactor`)
  };
}

function primitiveMaterialOrder(document: JsonObject): (number | null)[] {
  const rawNodes = array(document.nodes, "nodes").map((value, index) => object(value, `nodes[${index}]`));
  const rawMeshes = array(document.meshes, "meshes").map((value, index) => object(value, `meshes[${index}]`));
  const rawScenes = array(document.scenes, "scenes").map((value, index) => object(value, `scenes[${index}]`));
  const sceneIndex = document.scene === undefined ? 0 : Number(document.scene);
  const scene = rawScenes[sceneIndex] ?? rawScenes[0];
  const roots = scene ? array(scene.nodes, `scenes[${sceneIndex}].nodes`).map(Number) : rawNodes.map((_, index) => index);
  const visited = new Set<number>();
  const order: (number | null)[] = [];

  const visit = (nodeIndex: number) => {
    if (visited.has(nodeIndex)) return;
    const node = rawNodes[nodeIndex];
    if (!node) return;
    visited.add(nodeIndex);
    if (node.mesh !== undefined) {
      const mesh = rawMeshes[Number(node.mesh)];
      for (const [primitiveIndex, rawPrimitive] of array(mesh?.primitives, `meshes[${Number(node.mesh)}].primitives`).entries()) {
        const primitive = object(rawPrimitive, `meshes[${Number(node.mesh)}].primitives[${primitiveIndex}]`);
        order.push(primitive.material === undefined ? null : Number(primitive.material));
      }
    }
    for (const child of array(node.children, `nodes[${nodeIndex}].children`)) visit(Number(child));
  };
  for (const root of roots) visit(root);
  return order;
}

export function parsePbrLiteGlb(buffer: ArrayBuffer): PbrLiteModel {
  const lit = parseLitGlb(buffer);
  const document = parseDocument(buffer);
  const materials = array(document.materials, "materials").map((value, index) => object(value, `materials[${index}]`));
  const order = primitiveMaterialOrder(document);
  if (order.length !== lit.drawables.length) throw new Error("Ordem de materiais não corresponde às primitivas renderizáveis.");

  let metallicMaterials = 0;
  let emissiveMaterials = 0;
  const drawables = lit.drawables.map((drawable, index): PbrLiteDrawable => {
    const materialIndex = order[index];
    const profile = materialProfile(materialIndex === null ? null : materials[materialIndex] ?? null, materialIndex ?? -1);
    if (profile.metallic > 0.001) metallicMaterials += 1;
    if (profile.emissive.some((value) => value > 0.001)) emissiveMaterials += 1;
    return { ...drawable, ...profile };
  });

  return {
    drawables,
    explicitNormalPrimitives: lit.explicitNormalPrimitives,
    fallbackNormalPrimitives: lit.fallbackNormalPrimitives,
    metallicMaterials,
    emissiveMaterials,
    materialModel: "pbr-lite-factors-v1"
  };
}

// Tehkné Solutions
