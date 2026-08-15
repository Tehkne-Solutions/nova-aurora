import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLitGlb } from "./glb-lit-runtime.js";

type JsonObject = Record<string, unknown>;

function padded(bytes: Buffer, fill = 0x20): Buffer {
  const padding = (4 - bytes.length % 4) % 4;
  return padding === 0 ? bytes : Buffer.concat([bytes, Buffer.alloc(padding, fill)]);
}

function makeGlb(document: JsonObject, binary: Uint8Array): ArrayBuffer {
  const json = padded(Buffer.from(JSON.stringify(document), "utf8"));
  const bin = padded(Buffer.from(binary), 0);
  const length = 12 + 8 + json.length + 8 + bin.length;
  const output = Buffer.alloc(length);
  output.write("glTF", 0, "ascii");
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(length, 8);
  output.writeUInt32LE(json.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  json.copy(output, 20);
  const binHeader = 20 + json.length;
  output.writeUInt32LE(bin.length, binHeader);
  output.writeUInt32LE(0x004e4942, binHeader + 4);
  bin.copy(output, binHeader + 8);
  const copy = new Uint8Array(output.length);
  copy.set(output);
  return copy.buffer;
}

function triangleBinary(includeNormals: boolean): Buffer {
  const bytes = Buffer.alloc(includeNormals ? 72 : 36);
  const positions = [-0.7, -0.55, 0, 0.7, -0.55, 0, 0, 0.75, 0];
  positions.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  if (includeNormals) {
    const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
    normals.forEach((value, index) => bytes.writeFloatLE(value, 36 + index * 4));
  }
  return bytes;
}

function triangleDocument(options: Readonly<{
  normals?: boolean;
  alphaMode?: string;
  doubleSided?: boolean;
  scale?: readonly [number, number, number];
}> = {}): JsonObject {
  const normals = options.normals === true;
  const attributes: Record<string, number> = { POSITION: 0 };
  if (normals) attributes.NORMAL = 1;
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, ...(options.scale ? { scale: options.scale } : {}) }],
    meshes: [{ primitives: [{ attributes, material: 0, mode: 4 }] }],
    materials: [{
      ...(options.alphaMode ? { alphaMode: options.alphaMode } : {}),
      doubleSided: options.doubleSided === true,
      pbrMetallicRoughness: { baseColorFactor: [0.2, 0.6, 0.8, 1] }
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      ...(normals ? [{ bufferView: 1, componentType: 5126, count: 3, type: "VEC3" }] : [])
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      ...(normals ? [{ buffer: 0, byteOffset: 36, byteLength: 36 }] : [])
    ],
    buffers: [{ byteLength: normals ? 72 : 36 }]
  };
}

test("uses authored NORMAL accessors for lit GLB geometry", () => {
  const model = parseLitGlb(makeGlb(triangleDocument({ normals: true }), triangleBinary(true)));
  assert.equal(model.drawables.length, 1);
  assert.equal(model.explicitNormalPrimitives, 1);
  assert.equal(model.fallbackNormalPrimitives, 0);
  assert.equal(model.drawables[0]?.normalSource, "accessor");
  assert.deepEqual(Array.from(model.drawables[0]?.normals ?? []), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
});

test("computes flat face normals when NORMAL is absent", () => {
  const model = parseLitGlb(makeGlb(triangleDocument(), triangleBinary(false)));
  assert.equal(model.explicitNormalPrimitives, 0);
  assert.equal(model.fallbackNormalPrimitives, 1);
  assert.equal(model.drawables[0]?.normalSource, "flat-fallback");
  const normals = Array.from(model.drawables[0]?.normals ?? []);
  assert.equal(normals.length, 9);
  for (let index = 0; index < normals.length; index += 3) {
    assert.ok(Math.abs(normals[index] ?? 0) < 1e-6);
    assert.ok(Math.abs(normals[index + 1] ?? 0) < 1e-6);
    assert.ok(Math.abs((normals[index + 2] ?? 0) - 1) < 1e-6);
  }
});

test("preserves base color, double-sided material and normalized normals under nonuniform scale", () => {
  const model = parseLitGlb(makeGlb(
    triangleDocument({ normals: true, doubleSided: true, scale: [2, 1, 0.5] }),
    triangleBinary(true)
  ));
  const drawable = model.drawables[0];
  assert.ok(drawable);
  assert.deepEqual(drawable.color, [0.2, 0.6, 0.8, 1]);
  assert.equal(drawable.doubleSided, true);
  for (let index = 0; index < drawable.normals.length; index += 3) {
    const length = Math.hypot(drawable.normals[index]!, drawable.normals[index + 1]!, drawable.normals[index + 2]!);
    assert.ok(Math.abs(length - 1) < 1e-6);
  }
});

test("rejects transparent material modes outside the current safe lit profile", () => {
  assert.throws(
    () => parseLitGlb(makeGlb(triangleDocument({ normals: true, alphaMode: "BLEND" }), triangleBinary(true))),
    /alphaMode=BLEND/
  );
});

// Tehkné Solutions
