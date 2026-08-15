import assert from "node:assert/strict";
import { test } from "node:test";
import { GlbSecurityError } from "./glb-structural-security.js";
import { validateGlbNormalMapTangents } from "./glb-tangent-security.js";

type JsonObject = Record<string, unknown>;

function padded(buffer: Buffer, fill = 0x20): Buffer {
  const padding = (4 - buffer.length % 4) % 4;
  return padding === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(padding, fill)]);
}

function makeGlb(document: JsonObject, binary: Buffer): Buffer {
  const json = padded(Buffer.from(JSON.stringify(document), "utf8"));
  const bin = padded(binary, 0);
  const total = 12 + 8 + json.length + 8 + bin.length;
  const glb = Buffer.alloc(total);
  glb.write("glTF", 0, "ascii");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(total, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  const offset = 20 + json.length;
  glb.writeUInt32LE(bin.length, offset);
  glb.writeUInt32LE(0x004e4942, offset + 4);
  bin.copy(glb, offset + 8);
  return glb;
}

function normalMappedTriangle(options: Readonly<{
  tangentW?: number;
  tangentVector?: readonly [number, number, number];
  normalVector?: readonly [number, number, number];
  includeNormalTexture?: boolean;
  includeTangent?: boolean;
  includeNormal?: boolean;
  includeUv?: boolean;
  tangentCount?: number;
}> = {}): Buffer {
  const positions = [
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
    0, 0.5, 0
  ];
  const normal = options.normalVector ?? [0, 0, 1] as const;
  const tangent = options.tangentVector ?? [1, 0, 0] as const;
  const tangentW = options.tangentW ?? 1;
  const normals = Array.from({ length: 3 }, () => normal).flat();
  const tangents = Array.from({ length: 3 }, () => [tangent[0], tangent[1], tangent[2], tangentW]).flat();
  const uvs = [0, 0, 1, 0, 0.5, 1];
  const binary = Buffer.alloc(36 + 36 + 48 + 24);
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  normals.forEach((value, index) => binary.writeFloatLE(value, 36 + index * 4));
  tangents.forEach((value, index) => binary.writeFloatLE(value, 72 + index * 4));
  uvs.forEach((value, index) => binary.writeFloatLE(value, 120 + index * 4));

  const attributes: JsonObject = { POSITION: 0 };
  if (options.includeNormal !== false) attributes.NORMAL = 1;
  if (options.includeTangent !== false) attributes.TANGENT = 2;
  if (options.includeUv !== false) attributes.TEXCOORD_0 = 3;
  const material = options.includeNormalTexture === false ? {} : { normalTexture: { index: 0, texCoord: 0, scale: 1 } };
  const document: JsonObject = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes, material: 0, mode: 4 }] }],
    materials: [material],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: options.tangentCount ?? 3, type: "VEC4" },
      { bufferView: 3, componentType: 5126, count: 3, type: "VEC2" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 48 },
      { buffer: 0, byteOffset: 120, byteLength: 24 }
    ],
    buffers: [{ byteLength: binary.length }]
  };
  return makeGlb(document, binary);
}

function expectCode(code: string, run: () => unknown): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof GlbSecurityError);
    assert.equal(error.code, code);
    return true;
  });
}

test("certifies authored tangent space for a normal-mapped primitive", () => {
  const report = validateGlbNormalMapTangents(normalMappedTriangle());
  assert.equal(report.version, 1);
  assert.equal(report.normalMappedPrimitives, 1);
  assert.equal(report.validatedVertices, 3);
  assert.equal(report.tangentAccessors, 1);
  assert.equal(report.normalAccessors, 1);
  assert.equal(report.texCoordAccessors, 1);
  assert.equal(report.generatedTangents, 0);
  assert.equal(report.maxUnitLengthError, 0);
  assert.equal(report.maxOrthogonalityError, 0);
  assert.equal(report.signature, "Tehkné Solutions");
});

test("does not require tangents when no normalTexture is authored", () => {
  const report = validateGlbNormalMapTangents(normalMappedTriangle({
    includeNormalTexture: false,
    includeNormal: false,
    includeTangent: false,
    includeUv: false
  }));
  assert.equal(report.normalMappedPrimitives, 0);
  assert.equal(report.validatedVertices, 0);
});

test("fails closed when normalTexture has no authored tangent", () => {
  expectCode("normal-map-missing-tangent", () => validateGlbNormalMapTangents(normalMappedTriangle({ includeTangent: false })));
});

test("fails closed when normalTexture has no vertex normal", () => {
  expectCode("normal-map-missing-normal", () => validateGlbNormalMapTangents(normalMappedTriangle({ includeNormal: false })));
});

test("fails closed when normalTexture has no TEXCOORD_0", () => {
  expectCode("normal-map-missing-uv", () => validateGlbNormalMapTangents(normalMappedTriangle({ includeUv: false })));
});

test("fails closed when tangent handedness is not exactly plus/minus one", () => {
  expectCode("tangent-handedness", () => validateGlbNormalMapTangents(normalMappedTriangle({ tangentW: 0.5 })));
});

test("fails closed when tangent XYZ is not unit length", () => {
  expectCode("tangent-unit-length", () => validateGlbNormalMapTangents(normalMappedTriangle({ tangentVector: [2, 0, 0] })));
});

test("fails closed when tangent is not orthogonal to normal", () => {
  expectCode("tangent-orthogonality", () => validateGlbNormalMapTangents(normalMappedTriangle({ tangentVector: [0, 0, 1] })));
});

test("fails closed when tangent count differs from POSITION", () => {
  expectCode("tangent-attribute-count", () => validateGlbNormalMapTangents(normalMappedTriangle({ tangentCount: 2 })));
});

// Tehkné Solutions
