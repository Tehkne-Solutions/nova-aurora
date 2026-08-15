import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNormalMappedPbrGlb } from "./glb-normal-map-runtime.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

type JsonObject = Record<string, unknown>;

function padded(bytes: Buffer, fill = 0x20): Buffer {
  const padding = (4 - bytes.length % 4) % 4;
  return padding === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(padding, fill)]);
}

function makeGlb(options: Readonly<{
  normalTexture?: boolean;
  includeTangent?: boolean;
  normalScale?: number;
  nodeScale?: readonly [number, number, number];
}> = {}): ArrayBuffer {
  const positions = [-0.7, -0.55, 0, 0.7, -0.55, 0, 0, 0.75, 0];
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  const tangents = [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1];
  const texCoords = [0, 0, 1, 0, 0.5, 1];
  const positionsOffset = 0;
  const normalsOffset = 36;
  const tangentsOffset = 72;
  const uvOffset = 120;
  const imageOffset = 144;
  const binary = Buffer.alloc(imageOffset + PNG_1X1.length);
  positions.forEach((value, index) => binary.writeFloatLE(value, positionsOffset + index * 4));
  normals.forEach((value, index) => binary.writeFloatLE(value, normalsOffset + index * 4));
  tangents.forEach((value, index) => binary.writeFloatLE(value, tangentsOffset + index * 4));
  texCoords.forEach((value, index) => binary.writeFloatLE(value, uvOffset + index * 4));
  PNG_1X1.copy(binary, imageOffset);

  const attributes: JsonObject = { POSITION: 0, NORMAL: 1, TEXCOORD_0: 3 };
  if (options.includeTangent !== false) attributes.TANGENT = 2;
  const material: JsonObject = {
    pbrMetallicRoughness: { baseColorFactor: [0.65, 0.7, 0.8, 1], metallicFactor: 0.1, roughnessFactor: 0.75 }
  };
  if (options.normalTexture !== false) material.normalTexture = { index: 0, texCoord: 0, scale: options.normalScale ?? 0.85 };
  const node: JsonObject = { mesh: 0 };
  if (options.nodeScale) node.scale = options.nodeScale;

  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [node],
    meshes: [{ primitives: [{ attributes, material: 0, mode: 4 }] }],
    materials: [material],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC4" },
      { bufferView: 3, componentType: 5126, count: 3, type: "VEC2" }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: positionsOffset, byteLength: 36 },
      { buffer: 0, byteOffset: normalsOffset, byteLength: 36 },
      { buffer: 0, byteOffset: tangentsOffset, byteLength: 48 },
      { buffer: 0, byteOffset: uvOffset, byteLength: 24 },
      { buffer: 0, byteOffset: imageOffset, byteLength: PNG_1X1.length }
    ],
    buffers: [{ byteLength: binary.length }],
    images: [{ bufferView: 4, mimeType: "image/png" }],
    samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }],
    textures: [{ source: 0, sampler: 0 }]
  };

  const json = padded(Buffer.from(JSON.stringify(document), "utf8"));
  const bin = padded(binary, 0);
  const length = 12 + 8 + json.length + 8 + bin.length;
  const output = Buffer.alloc(length);
  output.write("glTF", 0, "ascii");
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(length, 8);
  output.writeUInt32LE(json.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  json.copy(output, 20);
  const offset = 20 + json.length;
  output.writeUInt32LE(bin.length, offset);
  output.writeUInt32LE(0x004e4942, offset + 4);
  bin.copy(output, offset + 8);
  const copy = new Uint8Array(output.length);
  copy.set(output);
  return copy.buffer;
}

test("parses normalTexture with authored tangent frame and scale", () => {
  const model = parseNormalMappedPbrGlb(makeGlb());
  const drawable = model.drawables[0];
  assert.ok(drawable);
  assert.equal(model.materialModel, "pbr-tangent-normal-map-v1");
  assert.equal(model.normalMappedMaterials, 1);
  assert.equal(model.authoredTangentPrimitives, 1);
  assert.equal(model.uniqueEmbeddedTextures, 1);
  assert.equal(model.embeddedTextureBytes, PNG_1X1.length);
  assert.equal(drawable.normalTexture?.mimeType, "image/png");
  assert.equal(drawable.normalScale, 0.85);
  assert.deepEqual(Array.from(drawable.tangents ?? []), [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
});

test("flips tangent handedness under mirrored node transform", () => {
  const model = parseNormalMappedPbrGlb(makeGlb({ nodeScale: [-1, 1, 1] }));
  const tangents = Array.from(model.drawables[0]?.tangents ?? []);
  assert.equal(tangents[3], -1);
  assert.equal(tangents[7], -1);
  assert.equal(tangents[11], -1);
  assert.equal(tangents[0], -1);
});

test("remains backwards compatible when normalTexture is absent", () => {
  const model = parseNormalMappedPbrGlb(makeGlb({ normalTexture: false, includeTangent: false }));
  const drawable = model.drawables[0];
  assert.equal(model.normalMappedMaterials, 0);
  assert.equal(model.authoredTangentPrimitives, 0);
  assert.equal(drawable?.normalTexture, null);
  assert.equal(drawable?.tangents, null);
});

test("fails closed when normalTexture has no authored tangent", () => {
  assert.throws(
    () => parseNormalMappedPbrGlb(makeGlb({ includeTangent: false })),
    /normalTexture sem TANGENT authored certificado/
  );
});

test("fails closed when normalTexture scale exceeds the v7 safety profile", () => {
  assert.throws(
    () => parseNormalMappedPbrGlb(makeGlb({ normalScale: 20 })),
    /normalTexture.scale precisa ser finito entre -8 e 8/
  );
});

// Tehkné Solutions
