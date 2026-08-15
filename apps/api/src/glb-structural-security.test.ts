import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GLB_SECURITY_LIMITS,
  GlbSecurityError,
  validateGlbForRuntime
} from "./glb-structural-security.js";

type JsonObject = Record<string, unknown>;

function padded(buffer: Buffer, fill = 0x20): Buffer {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(padding, fill)]);
}

function makeGlb(document: JsonObject, binary = Buffer.alloc(0)): Buffer {
  const json = padded(Buffer.from(JSON.stringify(document), "utf8"));
  const bin = binary.length > 0 ? padded(binary, 0) : Buffer.alloc(0);
  const total = 12 + 8 + json.length + (bin.length > 0 ? 8 + bin.length : 0);
  const glb = Buffer.alloc(total);
  glb.write("glTF", 0, "ascii");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(total, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  if (bin.length > 0) {
    const offset = 20 + json.length;
    glb.writeUInt32LE(bin.length, offset);
    glb.writeUInt32LE(0x004e4942, offset + 4);
    bin.copy(glb, offset + 8);
  }
  return glb;
}

function triangleDocument(overrides: JsonObject = {}): { document: JsonObject; binary: Buffer } {
  const binary = Buffer.alloc(36);
  const vertices = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0];
  vertices.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  return {
    binary,
    document: {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
      ...overrides
    }
  };
}

function expectSecurityCode(code: string, run: () => unknown): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof GlbSecurityError);
    assert.equal(error.code, code);
    return true;
  });
}

test("accepts the restricted GLB 2.0 runtime profile", () => {
  const { document, binary } = triangleDocument();
  const report = validateGlbForRuntime(makeGlb(document, binary));
  assert.equal(report.version, 2);
  assert.equal(report.nodes, 1);
  assert.equal(report.meshes, 1);
  assert.equal(report.primitives, 1);
  assert.equal(report.totalVertices, 3);
  assert.equal(report.totalIndices, 0);
  assert.equal(report.externalResources, 0);
  assert.equal(report.requiredExtensions, 0);
  assert.equal(report.signature, "Tehkné Solutions");
});

test("rejects magic-valid GLB with external buffer URI", () => {
  const { document } = triangleDocument({
    buffers: [{ byteLength: 36, uri: "https://example.invalid/model.bin" }]
  });
  expectSecurityCode("external-resource", () => validateGlbForRuntime(makeGlb(document)));
});

test("rejects GLB requiring an unsupported extension", () => {
  const { document, binary } = triangleDocument({
    extensionsRequired: ["KHR_draco_mesh_compression"]
  });
  expectSecurityCode("required-extension", () => validateGlbForRuntime(makeGlb(document, binary)));
});

test("rejects cyclic node graphs", () => {
  const { document, binary } = triangleDocument({
    nodes: [{ mesh: 0, children: [1] }, { children: [0] }],
    scenes: [{ nodes: [0] }]
  });
  expectSecurityCode("node-cycle", () => validateGlbForRuntime(makeGlb(document, binary)));
});

test("rejects accessors whose byte range exceeds the bufferView", () => {
  const { document, binary } = triangleDocument({
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: "VEC3" }]
  });
  expectSecurityCode("accessor-range", () => validateGlbForRuntime(makeGlb(document, binary)));
});

test("rejects node counts above the runtime complexity budget", () => {
  const { document, binary } = triangleDocument({
    nodes: Array.from({ length: GLB_SECURITY_LIMITS.maxNodes + 1 }, (_, index) => index === 0 ? { mesh: 0 } : {})
  });
  expectSecurityCode("complexity-limit", () => validateGlbForRuntime(makeGlb(document, binary)));
});

test("rejects TRIANGLES with a non-multiple-of-three vertex count", () => {
  const binary = Buffer.alloc(48);
  const { document } = triangleDocument({
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: "VEC3" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48 }],
    buffers: [{ byteLength: 48 }]
  });
  expectSecurityCode("triangle-count", () => validateGlbForRuntime(makeGlb(document, binary)));
});

// Tehkné Solutions
