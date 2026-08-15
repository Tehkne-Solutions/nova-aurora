const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

export const GLB_SECURITY_LIMITS = Object.freeze({
  maxJsonBytes: 2 * 1024 * 1024,
  maxNodes: 1024,
  maxMeshes: 256,
  maxPrimitives: 2048,
  maxAccessors: 4096,
  maxBufferViews: 4096,
  maxMaterials: 512,
  maxImages: 256,
  maxTextures: 256,
  maxScenes: 64,
  maxAnimations: 128,
  maxSkins: 128,
  maxTotalVertices: 1_000_000,
  maxTotalIndices: 3_000_000,
  maxChildrenPerNode: 256,
  maxByteStride: 252
});

export type GlbSecurityReport = Readonly<{
  version: 2;
  jsonBytes: number;
  binaryBytes: number;
  nodes: number;
  meshes: number;
  primitives: number;
  accessors: number;
  bufferViews: number;
  materials: number;
  images: number;
  textures: number;
  totalVertices: number;
  totalIndices: number;
  externalResources: 0;
  requiredExtensions: 0;
  signature: "Tehkné Solutions";
}>;

export class GlbSecurityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GlbSecurityError";
    this.code = code;
  }
}

type JsonRecord = Record<string, unknown>;

function fail(code: string, message: string): never {
  throw new GlbSecurityError(code, message);
}

function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-json-shape", `${label} precisa ser um objeto.`);
  }
  return value as JsonRecord;
}

function optionalObject(value: unknown, label: string): JsonRecord | null {
  if (value === undefined) return null;
  return object(value, label);
}

function array(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("invalid-json-shape", `${label} precisa ser um array.`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) {
    fail("invalid-integer", `${label} precisa ser um inteiro >= ${minimum}.`);
  }
  return Number(value);
}

function optionalInteger(value: unknown, label: string, defaultValue = 0): number {
  return value === undefined ? defaultValue : integer(value, label);
}

function boundedCount(values: unknown[], maximum: number, label: string): void {
  if (values.length > maximum) {
    fail("complexity-limit", `${label} excede o limite seguro de ${maximum}.`);
  }
}

function componentBytes(componentType: number): number {
  if (componentType === 5120 || componentType === 5121) return 1;
  if (componentType === 5122 || componentType === 5123) return 2;
  if (componentType === 5125 || componentType === 5126) return 4;
  return fail("unsupported-component-type", `componentType ${componentType} não é suportado.`);
}

function componentsForType(type: unknown): number {
  if (type === "SCALAR") return 1;
  if (type === "VEC2") return 2;
  if (type === "VEC3") return 3;
  if (type === "VEC4" || type === "MAT2") return 4;
  if (type === "MAT3") return 9;
  if (type === "MAT4") return 16;
  return fail("unsupported-accessor-type", `Accessor type ${String(type)} não é suportado.`);
}

function assertIndex(index: unknown, length: number, label: string): number {
  const parsed = integer(index, label);
  if (parsed >= length) fail("reference-out-of-range", `${label} aponta para índice inexistente ${parsed}.`);
  return parsed;
}

function assertNoExternalUri(resource: JsonRecord, label: string): void {
  if (resource.uri !== undefined) {
    fail("external-resource", `${label} usa URI externa/data URI; o runtime GLB seguro aceita somente bytes incorporados.`);
  }
}

function parseChunks(bytes: Buffer): { document: JsonRecord; jsonBytes: number; binary: Buffer } {
  if (bytes.length < 20) fail("container-too-small", "GLB incompleto.");
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) fail("invalid-magic", "Magic GLB inválido.");
  if (bytes.readUInt32LE(4) !== 2) fail("unsupported-version", "Somente GLB 2.0 é aceito.");
  if (bytes.readUInt32LE(8) !== bytes.length) fail("length-mismatch", "Comprimento declarado do GLB não corresponde aos bytes recebidos.");

  let offset = 12;
  let jsonChunk: Buffer | null = null;
  let binaryChunk: Buffer | null = null;
  let chunkIndex = 0;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail("truncated-chunk-header", "Cabeçalho de chunk GLB truncado.");
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (chunkLength % 4 !== 0) fail("chunk-alignment", "Chunk GLB precisa estar alinhado em 4 bytes.");
    if (offset + chunkLength > bytes.length) fail("truncated-chunk", "Chunk GLB ultrapassa o tamanho declarado do arquivo.");
    const chunk = bytes.subarray(offset, offset + chunkLength);

    if (chunkIndex === 0 && chunkType !== GLB_JSON_CHUNK) {
      fail("json-first", "O primeiro chunk do GLB precisa ser JSON.");
    }
    if (chunkType === GLB_JSON_CHUNK) {
      if (jsonChunk) fail("duplicate-json", "GLB contém mais de um chunk JSON.");
      if (chunkLength > GLB_SECURITY_LIMITS.maxJsonBytes) {
        fail("json-too-large", `Chunk JSON excede ${GLB_SECURITY_LIMITS.maxJsonBytes} bytes.`);
      }
      jsonChunk = chunk;
    } else if (chunkType === GLB_BIN_CHUNK) {
      if (binaryChunk) fail("duplicate-bin", "GLB contém mais de um chunk BIN.");
      binaryChunk = chunk;
    } else {
      fail("unknown-chunk", `Chunk GLB não suportado: 0x${chunkType.toString(16)}.`);
    }

    offset += chunkLength;
    chunkIndex += 1;
  }

  if (!jsonChunk) fail("missing-json", "GLB não contém chunk JSON.");
  const jsonText = jsonChunk.toString("utf8").replace(/[\u0000\u0020]+$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return fail("invalid-json", "Chunk JSON do GLB não é JSON válido.");
  }
  return {
    document: object(parsed, "Documento glTF"),
    jsonBytes: jsonChunk.length,
    binary: binaryChunk ?? Buffer.alloc(0)
  };
}

function validateGraph(nodes: JsonRecord[], scenes: JsonRecord[], defaultScene: unknown): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const children = array(nodes[index]!.children, `nodes[${index}].children`);
    boundedCount(children, GLB_SECURITY_LIMITS.maxChildrenPerNode, `nodes[${index}].children`);
    for (let child = 0; child < children.length; child += 1) {
      assertIndex(children[child], nodes.length, `nodes[${index}].children[${child}]`);
    }
  }

  for (let index = 0; index < scenes.length; index += 1) {
    const roots = array(scenes[index]!.nodes, `scenes[${index}].nodes`);
    for (let root = 0; root < roots.length; root += 1) {
      assertIndex(roots[root], nodes.length, `scenes[${index}].nodes[${root}]`);
    }
  }
  if (defaultScene !== undefined) assertIndex(defaultScene, scenes.length, "scene");

  const state = new Uint8Array(nodes.length);
  const visit = (nodeIndex: number) => {
    if (state[nodeIndex] === 1) fail("node-cycle", `Ciclo detectado no grafo de nodes em ${nodeIndex}.`);
    if (state[nodeIndex] === 2) return;
    state[nodeIndex] = 1;
    const children = array(nodes[nodeIndex]!.children, `nodes[${nodeIndex}].children`);
    for (const child of children) visit(assertIndex(child, nodes.length, `nodes[${nodeIndex}].children`));
    state[nodeIndex] = 2;
  };
  for (let index = 0; index < nodes.length; index += 1) visit(index);
}

export function validateGlbForRuntime(bytes: Buffer): GlbSecurityReport {
  const { document, jsonBytes, binary } = parseChunks(bytes);
  const asset = object(document.asset, "asset");
  if (asset.version !== "2.0") fail("asset-version", "asset.version precisa ser 2.0.");

  const requiredExtensions = array(document.extensionsRequired, "extensionsRequired");
  if (requiredExtensions.length > 0) {
    fail("required-extension", `GLB exige extensões não suportadas: ${requiredExtensions.map(String).join(", ")}.`);
  }

  const buffers = array(document.buffers, "buffers").map((value, index) => object(value, `buffers[${index}]`));
  if (buffers.length > 1) fail("buffer-count", "Runtime seguro aceita no máximo um buffer BIN incorporado.");
  for (let index = 0; index < buffers.length; index += 1) assertNoExternalUri(buffers[index]!, `buffers[${index}]`);
  const declaredBinaryBytes = buffers.length === 0 ? 0 : integer(buffers[0]!.byteLength, "buffers[0].byteLength");
  if (declaredBinaryBytes > binary.length || binary.length - declaredBinaryBytes > 3) {
    fail("binary-length", "buffer[0].byteLength não corresponde ao chunk BIN (considerando apenas padding de 0–3 bytes)." );
  }
  if (declaredBinaryBytes > 0 && binary.length === 0) fail("missing-bin", "GLB declara buffer mas não contém chunk BIN.");

  const bufferViews = array(document.bufferViews, "bufferViews").map((value, index) => object(value, `bufferViews[${index}]`));
  const accessors = array(document.accessors, "accessors").map((value, index) => object(value, `accessors[${index}]`));
  const meshes = array(document.meshes, "meshes").map((value, index) => object(value, `meshes[${index}]`));
  const nodes = array(document.nodes, "nodes").map((value, index) => object(value, `nodes[${index}]`));
  const scenes = array(document.scenes, "scenes").map((value, index) => object(value, `scenes[${index}]`));
  const materials = array(document.materials, "materials").map((value, index) => object(value, `materials[${index}]`));
  const images = array(document.images, "images").map((value, index) => object(value, `images[${index}]`));
  const textures = array(document.textures, "textures").map((value, index) => object(value, `textures[${index}]`));
  const animations = array(document.animations, "animations");
  const skins = array(document.skins, "skins");

  boundedCount(nodes, GLB_SECURITY_LIMITS.maxNodes, "nodes");
  boundedCount(meshes, GLB_SECURITY_LIMITS.maxMeshes, "meshes");
  boundedCount(accessors, GLB_SECURITY_LIMITS.maxAccessors, "accessors");
  boundedCount(bufferViews, GLB_SECURITY_LIMITS.maxBufferViews, "bufferViews");
  boundedCount(materials, GLB_SECURITY_LIMITS.maxMaterials, "materials");
  boundedCount(images, GLB_SECURITY_LIMITS.maxImages, "images");
  boundedCount(textures, GLB_SECURITY_LIMITS.maxTextures, "textures");
  boundedCount(scenes, GLB_SECURITY_LIMITS.maxScenes, "scenes");
  boundedCount(animations, GLB_SECURITY_LIMITS.maxAnimations, "animations");
  boundedCount(skins, GLB_SECURITY_LIMITS.maxSkins, "skins");

  for (let index = 0; index < images.length; index += 1) assertNoExternalUri(images[index]!, `images[${index}]`);

  for (let index = 0; index < bufferViews.length; index += 1) {
    const view = bufferViews[index]!;
    const bufferIndex = integer(view.buffer, `bufferViews[${index}].buffer`);
    if (bufferIndex !== 0 || buffers.length !== 1) fail("buffer-reference", `bufferViews[${index}] precisa apontar para o buffer BIN 0.`);
    const byteOffset = optionalInteger(view.byteOffset, `bufferViews[${index}].byteOffset`);
    const byteLength = integer(view.byteLength, `bufferViews[${index}].byteLength`, 1);
    const byteStride = optionalInteger(view.byteStride, `bufferViews[${index}].byteStride`);
    if (byteStride > GLB_SECURITY_LIMITS.maxByteStride) fail("byte-stride", `bufferViews[${index}].byteStride excede ${GLB_SECURITY_LIMITS.maxByteStride}.`);
    if (byteOffset + byteLength > declaredBinaryBytes) fail("buffer-view-range", `bufferViews[${index}] ultrapassa buffer[0].byteLength.`);
  }

  for (let index = 0; index < accessors.length; index += 1) {
    const accessor = accessors[index]!;
    if (accessor.sparse !== undefined) fail("sparse-accessor", `accessors[${index}] usa sparse, não suportado pelo runtime seguro.`);
    const bufferViewIndex = assertIndex(accessor.bufferView, bufferViews.length, `accessors[${index}].bufferView`);
    const componentType = integer(accessor.componentType, `accessors[${index}].componentType`);
    const count = integer(accessor.count, `accessors[${index}].count`, 1);
    const components = componentsForType(accessor.type);
    const elementBytes = componentBytes(componentType) * components;
    const view = bufferViews[bufferViewIndex]!;
    const byteOffset = optionalInteger(accessor.byteOffset, `accessors[${index}].byteOffset`);
    const stride = optionalInteger(view.byteStride, `bufferViews[${bufferViewIndex}].byteStride`) || elementBytes;
    if (stride < elementBytes) fail("accessor-stride", `accessors[${index}] possui stride menor que o elemento.`);
    const required = byteOffset + stride * (count - 1) + elementBytes;
    if (required > integer(view.byteLength, `bufferViews[${bufferViewIndex}].byteLength`, 1)) {
      fail("accessor-range", `accessors[${index}] ultrapassa seu bufferView.`);
    }
  }

  let primitives = 0;
  let totalVertices = 0;
  let totalIndices = 0;
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    const mesh = meshes[meshIndex]!;
    const meshPrimitives = array(mesh.primitives, `meshes[${meshIndex}].primitives`);
    primitives += meshPrimitives.length;
    if (primitives > GLB_SECURITY_LIMITS.maxPrimitives) fail("complexity-limit", `primitives excede ${GLB_SECURITY_LIMITS.maxPrimitives}.`);
    for (let primitiveIndex = 0; primitiveIndex < meshPrimitives.length; primitiveIndex += 1) {
      const primitive = object(meshPrimitives[primitiveIndex], `meshes[${meshIndex}].primitives[${primitiveIndex}]`);
      const mode = optionalInteger(primitive.mode, `meshes[${meshIndex}].primitives[${primitiveIndex}].mode`, 4);
      if (mode !== 4) fail("primitive-mode", "Runtime seguro aceita somente primitivas TRIANGLES (mode=4)." );
      const attributes = object(primitive.attributes, `meshes[${meshIndex}].primitives[${primitiveIndex}].attributes`);
      const positionIndex = assertIndex(attributes.POSITION, accessors.length, `meshes[${meshIndex}].primitives[${primitiveIndex}].attributes.POSITION`);
      const position = accessors[positionIndex]!;
      if (position.componentType !== 5126 || position.type !== "VEC3") {
        fail("position-format", "POSITION precisa ser FLOAT VEC3 para o renderer first-party." );
      }
      const vertices = integer(position.count, `accessors[${positionIndex}].count`, 1);
      totalVertices += vertices;
      if (totalVertices > GLB_SECURITY_LIMITS.maxTotalVertices) fail("complexity-limit", `Vértices totais excedem ${GLB_SECURITY_LIMITS.maxTotalVertices}.`);

      if (primitive.indices !== undefined) {
        const indexAccessor = assertIndex(primitive.indices, accessors.length, `meshes[${meshIndex}].primitives[${primitiveIndex}].indices`);
        const indices = accessors[indexAccessor]!;
        if (indices.type !== "SCALAR" || ![5121, 5123, 5125].includes(Number(indices.componentType))) {
          fail("index-format", "Índices precisam ser SCALAR unsigned byte/short/int." );
        }
        const count = integer(indices.count, `accessors[${indexAccessor}].count`, 1);
        if (count % 3 !== 0) fail("triangle-count", "Accessor de índices TRIANGLES precisa ter count múltiplo de 3." );
        totalIndices += count;
      } else if (vertices % 3 !== 0) {
        fail("triangle-count", "POSITION não indexado TRIANGLES precisa ter count múltiplo de 3." );
      }
      if (totalIndices > GLB_SECURITY_LIMITS.maxTotalIndices) fail("complexity-limit", `Índices totais excedem ${GLB_SECURITY_LIMITS.maxTotalIndices}.`);
      if (primitive.material !== undefined) assertIndex(primitive.material, materials.length, `meshes[${meshIndex}].primitives[${primitiveIndex}].material`);
    }
  }

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    if (nodes[nodeIndex]!.mesh !== undefined) assertIndex(nodes[nodeIndex]!.mesh, meshes.length, `nodes[${nodeIndex}].mesh`);
  }
  validateGraph(nodes, scenes, document.scene);

  return {
    version: 2,
    jsonBytes,
    binaryBytes: declaredBinaryBytes,
    nodes: nodes.length,
    meshes: meshes.length,
    primitives,
    accessors: accessors.length,
    bufferViews: bufferViews.length,
    materials: materials.length,
    images: images.length,
    textures: textures.length,
    totalVertices,
    totalIndices,
    externalResources: 0,
    requiredExtensions: 0,
    signature: "Tehkné Solutions"
  };
}

// Tehkné Solutions
