import { GlbSecurityError, validateGlbForRuntime } from "./glb-structural-security.js";

export type GlbTangentSecurityReport = Readonly<{
  version: 1;
  normalMappedPrimitives: number;
  validatedVertices: number;
  tangentAccessors: number;
  normalAccessors: number;
  texCoordAccessors: number;
  generatedTangents: 0;
  maxUnitLengthError: number;
  maxOrthogonalityError: number;
  signature: "Tehkné Solutions";
}>;

type JsonObject = Record<string, unknown>;
type ParsedGlb = Readonly<{ document: JsonObject; bin: Uint8Array }>;
type AccessorLayout = Readonly<{
  accessor: JsonObject;
  count: number;
  offset: number;
  stride: number;
}>;

const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const UNIT_TOLERANCE = 0.01;
const ORTHOGONAL_TOLERANCE = 0.01;

function fail(code: string, message: string): never {
  throw new GlbSecurityError(code, message);
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("invalid-json-shape", `${label} precisa ser um objeto.`);
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail("invalid-json-shape", `${label} precisa ser um array.`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) return fail("invalid-integer", `${label} precisa ser inteiro >= ${minimum}.`);
  return Number(value);
}

function index(value: unknown, length: number, label: string): number {
  const parsed = integer(value, label);
  if (parsed >= length) return fail("reference-out-of-range", `${label} aponta para índice inexistente ${parsed}.`);
  return parsed;
}

function parseGlb(bytes: Buffer): ParsedGlb {
  // Reutiliza primeiro todo o contrato estrutural existente. Isso mantém este
  // gate pequeno e garante que offsets/strides/ranges abaixo já são seguros.
  validateGlbForRuntime(bytes);

  let offset = 12;
  let document: JsonObject | null = null;
  let bin: Uint8Array = new Uint8Array(0);
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    offset += 8;
    const chunk = bytes.subarray(offset, offset + length);
    if (type === GLB_JSON_CHUNK && !document) {
      const text = chunk.toString("utf8").replace(/[\u0000\u0020]+$/g, "");
      document = object(JSON.parse(text), "Documento glTF");
    } else if (type === GLB_BIN_CHUNK && bin.byteLength === 0) {
      bin = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }
    offset += length;
  }
  if (!document) return fail("missing-json", "GLB não contém documento JSON.");
  return { document, bin };
}

function layout(document: JsonObject, accessorIndex: number, label: string): AccessorLayout {
  const accessors = array(document.accessors, "accessors").map((value, position) => object(value, `accessors[${position}]`));
  const bufferViews = array(document.bufferViews, "bufferViews").map((value, position) => object(value, `bufferViews[${position}]`));
  const accessor = accessors[index(accessorIndex, accessors.length, label)]!;
  const viewIndex = index(accessor.bufferView, bufferViews.length, `${label}.bufferView`);
  const view = bufferViews[viewIndex]!;
  return {
    accessor,
    count: integer(accessor.count, `${label}.count`, 1),
    offset: Number(view.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0),
    stride: Number(view.byteStride ?? 0)
  };
}

function assertFloatAccessor(
  document: JsonObject,
  accessorIndex: number,
  expectedType: "VEC2" | "VEC3" | "VEC4",
  label: string
): AccessorLayout {
  const result = layout(document, accessorIndex, label);
  if (Number(result.accessor.componentType) !== 5126 || result.accessor.type !== expectedType) {
    return fail("tangent-attribute-format", `${label} precisa ser FLOAT ${expectedType}.`);
  }
  if (result.accessor.normalized === true) {
    return fail("tangent-attribute-format", `${label} FLOAT não deve declarar normalized=true.`);
  }
  return result;
}

function readFloat(view: DataView, offset: number, label: string): number {
  const value = view.getFloat32(offset, true);
  if (!Number.isFinite(value)) return fail("tangent-non-finite", `${label} contém valor não finito.`);
  return value;
}

function length3(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z);
}

function validatePrimitiveTangents(
  document: JsonObject,
  bin: Uint8Array,
  attributes: JsonObject,
  primitiveLabel: string,
  positionCount: number
): Readonly<{ vertices: number; unitError: number; orthogonalityError: number; tangent: number; normal: number; texCoord: number }> {
  if (attributes.NORMAL === undefined) return fail("normal-map-missing-normal", `${primitiveLabel} usa normalTexture sem NORMAL.`);
  if (attributes.TANGENT === undefined) return fail("normal-map-missing-tangent", `${primitiveLabel} usa normalTexture sem TANGENT authored.`);
  if (attributes.TEXCOORD_0 === undefined) return fail("normal-map-missing-uv", `${primitiveLabel} usa normalTexture sem TEXCOORD_0.`);

  const normalIndex = integer(attributes.NORMAL, `${primitiveLabel}.attributes.NORMAL`);
  const tangentIndex = integer(attributes.TANGENT, `${primitiveLabel}.attributes.TANGENT`);
  const texCoordIndex = integer(attributes.TEXCOORD_0, `${primitiveLabel}.attributes.TEXCOORD_0`);
  const normal = assertFloatAccessor(document, normalIndex, "VEC3", `${primitiveLabel}.NORMAL`);
  const tangent = assertFloatAccessor(document, tangentIndex, "VEC4", `${primitiveLabel}.TANGENT`);
  const texCoord = assertFloatAccessor(document, texCoordIndex, "VEC2", `${primitiveLabel}.TEXCOORD_0`);

  if (normal.count !== positionCount || tangent.count !== positionCount || texCoord.count !== positionCount) {
    return fail(
      "tangent-attribute-count",
      `${primitiveLabel} exige POSITION/NORMAL/TANGENT/TEXCOORD_0 com a mesma contagem de vértices.`
    );
  }

  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const normalStride = normal.stride || 12;
  const tangentStride = tangent.stride || 16;
  const uvStride = texCoord.stride || 8;
  let maxUnitLengthError = 0;
  let maxOrthogonalityError = 0;

  for (let vertex = 0; vertex < positionCount; vertex += 1) {
    const normalOffset = normal.offset + vertex * normalStride;
    const tangentOffset = tangent.offset + vertex * tangentStride;
    const uvOffset = texCoord.offset + vertex * uvStride;

    const nx = readFloat(data, normalOffset, `${primitiveLabel}.NORMAL[${vertex}].x`);
    const ny = readFloat(data, normalOffset + 4, `${primitiveLabel}.NORMAL[${vertex}].y`);
    const nz = readFloat(data, normalOffset + 8, `${primitiveLabel}.NORMAL[${vertex}].z`);
    const tx = readFloat(data, tangentOffset, `${primitiveLabel}.TANGENT[${vertex}].x`);
    const ty = readFloat(data, tangentOffset + 4, `${primitiveLabel}.TANGENT[${vertex}].y`);
    const tz = readFloat(data, tangentOffset + 8, `${primitiveLabel}.TANGENT[${vertex}].z`);
    const handedness = readFloat(data, tangentOffset + 12, `${primitiveLabel}.TANGENT[${vertex}].w`);
    readFloat(data, uvOffset, `${primitiveLabel}.TEXCOORD_0[${vertex}].u`);
    readFloat(data, uvOffset + 4, `${primitiveLabel}.TEXCOORD_0[${vertex}].v`);

    if (handedness !== 1 && handedness !== -1) {
      return fail("tangent-handedness", `${primitiveLabel}.TANGENT[${vertex}].w precisa ser exatamente +1 ou -1.`);
    }

    const normalLengthError = Math.abs(length3(nx, ny, nz) - 1);
    const tangentLengthError = Math.abs(length3(tx, ty, tz) - 1);
    const unitError = Math.max(normalLengthError, tangentLengthError);
    maxUnitLengthError = Math.max(maxUnitLengthError, unitError);
    if (unitError > UNIT_TOLERANCE) {
      return fail("tangent-unit-length", `${primitiveLabel} contém NORMAL/TANGENT fora da tolerância unitária ${UNIT_TOLERANCE}.`);
    }

    const orthogonality = Math.abs(nx * tx + ny * ty + nz * tz);
    maxOrthogonalityError = Math.max(maxOrthogonalityError, orthogonality);
    if (orthogonality > ORTHOGONAL_TOLERANCE) {
      return fail("tangent-orthogonality", `${primitiveLabel} contém TANGENT não ortogonal a NORMAL.`);
    }
  }

  return {
    vertices: positionCount,
    unitError: maxUnitLengthError,
    orthogonalityError: maxOrthogonalityError,
    tangent: tangentIndex,
    normal: normalIndex,
    texCoord: texCoordIndex
  };
}

export function validateGlbNormalMapTangents(bytes: Buffer): GlbTangentSecurityReport {
  const { document, bin } = parseGlb(bytes);
  const accessors = array(document.accessors, "accessors").map((value, position) => object(value, `accessors[${position}]`));
  const materials = array(document.materials, "materials").map((value, position) => object(value, `materials[${position}]`));
  const meshes = array(document.meshes, "meshes").map((value, position) => object(value, `meshes[${position}]`));

  const normalMappedMaterial = new Set<number>();
  for (let materialIndex = 0; materialIndex < materials.length; materialIndex += 1) {
    if (materials[materialIndex]!.normalTexture !== undefined) normalMappedMaterial.add(materialIndex);
  }

  let normalMappedPrimitives = 0;
  let validatedVertices = 0;
  let maxUnitLengthError = 0;
  let maxOrthogonalityError = 0;
  const tangentAccessors = new Set<number>();
  const normalAccessors = new Set<number>();
  const texCoordAccessors = new Set<number>();

  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    const primitives = array(meshes[meshIndex]!.primitives, `meshes[${meshIndex}].primitives`);
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
      const primitive = object(primitives[primitiveIndex], `meshes[${meshIndex}].primitives[${primitiveIndex}]`);
      if (primitive.material === undefined) continue;
      const materialIndex = integer(primitive.material, `meshes[${meshIndex}].primitives[${primitiveIndex}].material`);
      if (!normalMappedMaterial.has(materialIndex)) continue;
      const label = `meshes[${meshIndex}].primitives[${primitiveIndex}]`;
      const attributes = object(primitive.attributes, `${label}.attributes`);
      const positionIndex = index(attributes.POSITION, accessors.length, `${label}.POSITION`);
      const positionCount = integer(accessors[positionIndex]!.count, `accessors[${positionIndex}].count`, 1);
      const result = validatePrimitiveTangents(document, bin, attributes, label, positionCount);
      normalMappedPrimitives += 1;
      validatedVertices += result.vertices;
      maxUnitLengthError = Math.max(maxUnitLengthError, result.unitError);
      maxOrthogonalityError = Math.max(maxOrthogonalityError, result.orthogonalityError);
      tangentAccessors.add(result.tangent);
      normalAccessors.add(result.normal);
      texCoordAccessors.add(result.texCoord);
    }
  }

  return {
    version: 1,
    normalMappedPrimitives,
    validatedVertices,
    tangentAccessors: tangentAccessors.size,
    normalAccessors: normalAccessors.size,
    texCoordAccessors: texCoordAccessors.size,
    generatedTangents: 0,
    maxUnitLengthError,
    maxOrthogonalityError,
    signature: "Tehkné Solutions"
  };
}

// Tehkné Solutions
