"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./glb-placement.module.css";

type Props = Readonly<{
  assetUrl: string;
  label: string;
  rotationYDegrees?: number;
  current?: boolean;
}>;

type Vec3 = readonly [number, number, number];
type Mat4 = readonly number[];

type GltfAccessor = Readonly<{
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}>;

type GltfBufferView = Readonly<{
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}>;

type GltfPrimitive = Readonly<{
  attributes?: Readonly<Record<string, number>>;
  indices?: number;
  material?: number;
  mode?: number;
}>;

type GltfMesh = Readonly<{ primitives?: readonly GltfPrimitive[] }>;
type GltfNode = Readonly<{
  mesh?: number;
  children?: readonly number[];
  matrix?: readonly number[];
  translation?: readonly number[];
  rotation?: readonly number[];
  scale?: readonly number[];
}>;

type GltfMaterial = Readonly<{
  pbrMetallicRoughness?: Readonly<{ baseColorFactor?: readonly number[] }>;
}>;

type GltfDocument = Readonly<{
  asset?: Readonly<{ version?: string }>;
  accessors?: readonly GltfAccessor[];
  bufferViews?: readonly GltfBufferView[];
  meshes?: readonly GltfMesh[];
  nodes?: readonly GltfNode[];
  scenes?: readonly Readonly<{ nodes?: readonly number[] }>[];
  scene?: number;
  materials?: readonly GltfMaterial[];
}>;

type Drawable = Readonly<{
  positions: Float32Array;
  indices: Uint32Array | null;
  color: readonly [number, number, number, number];
}>;

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[0 * 4 + row]! * b[column * 4 + 0]!
        + a[1 * 4 + row]! * b[column * 4 + 1]!
        + a[2 * 4 + row]! * b[column * 4 + 2]!
        + a[3 * 4 + row]! * b[column * 4 + 3]!;
    }
  }
  return out;
}

function translation(x: number, y: number, z: number): number[] {
  const out = identity();
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

function scaling(x: number, y: number, z: number): number[] {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

function rotationY(radians: number): number[] {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function quaternionMatrix(x: number, y: number, z: number, w: number): number[] {
  const xx = x * x; const yy = y * y; const zz = z * z;
  const xy = x * y; const xz = x * z; const yz = y * z;
  const wx = w * x; const wy = w * y; const wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
    0, 0, 0, 1
  ];
}

function nodeMatrix(node: GltfNode): number[] {
  if (node.matrix?.length === 16) return Array.from(node.matrix, Number);
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  return multiply(
    multiply(translation(Number(t[0] ?? 0), Number(t[1] ?? 0), Number(t[2] ?? 0)), quaternionMatrix(Number(r[0] ?? 0), Number(r[1] ?? 0), Number(r[2] ?? 0), Number(r[3] ?? 1))),
    scaling(Number(s[0] ?? 1), Number(s[1] ?? 1), Number(s[2] ?? 1))
  );
}

function transformPoint(matrix: Mat4, point: Vec3): Vec3 {
  const [x, y, z] = point;
  return [
    matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
    matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
    matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!
  ];
}

function perspective(fovRadians: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan(fovRadians / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0
  ];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lookAt(eye: Vec3, target: Vec3, up: Vec3): number[] {
  const z = normalize(subtract(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
  ];
}

function parseGlb(buffer: ArrayBuffer): { json: GltfDocument; bin: Uint8Array } {
  if (buffer.byteLength < 20) throw new Error("GLB incompleto.");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Assinatura GLB inválida.");
  if (view.getUint32(4, true) !== 2) throw new Error("Somente GLB 2.0 é suportado.");
  const declaredLength = view.getUint32(8, true);
  if (declaredLength !== buffer.byteLength) throw new Error("Comprimento GLB inconsistente.");

  let offset = 12;
  let json: GltfDocument | null = null;
  let bin = new Uint8Array(0);
  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;
    if (chunkLength < 0 || offset + chunkLength > buffer.byteLength) throw new Error("Chunk GLB inválido.");
    const chunk = new Uint8Array(buffer, offset, chunkLength);
    if (chunkType === GLB_JSON_CHUNK && !json) {
      const text = new TextDecoder().decode(chunk).replace(/[\u0000\u0020]+$/g, "");
      json = JSON.parse(text) as GltfDocument;
    } else if (chunkType === GLB_BIN_CHUNK && bin.byteLength === 0) {
      bin = new Uint8Array(chunk);
    }
    offset += chunkLength;
  }
  if (!json || json.asset?.version !== "2.0") throw new Error("Documento glTF 2.0 ausente.");
  return { json, bin };
}

function accessorOffset(document: GltfDocument, accessor: GltfAccessor): { view: GltfBufferView; offset: number; stride: number } {
  if (accessor.bufferView === undefined) throw new Error("Accessor sem bufferView não suportado nesta fundação.");
  const view = document.bufferViews?.[accessor.bufferView];
  if (!view || view.buffer !== 0) throw new Error("Apenas o buffer BIN incorporado é suportado.");
  const offset = Number(view.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0);
  return { view, offset, stride: Number(view.byteStride ?? 0) };
}

function readPositions(document: GltfDocument, bin: Uint8Array, accessorIndex: number): Float32Array {
  const accessor = document.accessors?.[accessorIndex];
  if (!accessor || accessor.componentType !== 5126 || accessor.type !== "VEC3") {
    throw new Error("POSITION precisa ser FLOAT VEC3.");
  }
  const { offset, stride } = accessorOffset(document, accessor);
  const itemStride = stride || 12;
  if (offset + itemStride * Math.max(0, accessor.count - 1) + 12 > bin.byteLength) throw new Error("POSITION fora do buffer.");
  const source = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const output = new Float32Array(accessor.count * 3);
  for (let index = 0; index < accessor.count; index += 1) {
    const base = offset + index * itemStride;
    output[index * 3] = source.getFloat32(base, true);
    output[index * 3 + 1] = source.getFloat32(base + 4, true);
    output[index * 3 + 2] = source.getFloat32(base + 8, true);
  }
  return output;
}

function componentByteSize(componentType: number): number {
  if (componentType === 5121) return 1;
  if (componentType === 5123) return 2;
  if (componentType === 5125) return 4;
  throw new Error("Tipo de índice GLB não suportado.");
}

function readIndices(document: GltfDocument, bin: Uint8Array, accessorIndex: number): Uint32Array {
  const accessor = document.accessors?.[accessorIndex];
  if (!accessor || accessor.type !== "SCALAR") throw new Error("Índices precisam ser SCALAR.");
  const { offset, stride } = accessorOffset(document, accessor);
  const bytes = componentByteSize(accessor.componentType);
  const itemStride = stride || bytes;
  if (offset + itemStride * Math.max(0, accessor.count - 1) + bytes > bin.byteLength) throw new Error("Índices fora do buffer.");
  const source = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const output = new Uint32Array(accessor.count);
  for (let index = 0; index < accessor.count; index += 1) {
    const base = offset + index * itemStride;
    output[index] = accessor.componentType === 5121
      ? source.getUint8(base)
      : accessor.componentType === 5123
        ? source.getUint16(base, true)
        : source.getUint32(base, true);
  }
  return output;
}

function primitiveColor(document: GltfDocument, materialIndex?: number): readonly [number, number, number, number] {
  const factor = materialIndex === undefined
    ? null
    : document.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorFactor;
  return [
    Number(factor?.[0] ?? 0.44),
    Number(factor?.[1] ?? 0.76),
    Number(factor?.[2] ?? 0.64),
    Number(factor?.[3] ?? 1)
  ];
}

function buildDrawables(document: GltfDocument, bin: Uint8Array): Drawable[] {
  const meshes = document.meshes ?? [];
  const nodes = document.nodes ?? [];
  const scene = document.scenes?.[document.scene ?? 0] ?? document.scenes?.[0];
  const roots = scene?.nodes ?? nodes.map((_, index) => index);
  const drawables: Drawable[] = [];
  const visited = new Set<number>();

  const visit = (nodeIndex: number, parentMatrix: Mat4) => {
    if (visited.has(nodeIndex)) return;
    const node = nodes[nodeIndex];
    if (!node) return;
    visited.add(nodeIndex);
    const world = multiply(parentMatrix, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = meshes[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        if ((primitive.mode ?? 4) !== 4) throw new Error("Nesta fundação, o renderer GLB aceita primitivas TRIANGLES.");
        const positionAccessor = primitive.attributes?.POSITION;
        if (positionAccessor === undefined) throw new Error("Primitiva GLB sem POSITION.");
        const source = readPositions(document, bin, positionAccessor);
        const transformed = new Float32Array(source.length);
        for (let index = 0; index < source.length; index += 3) {
          const point = transformPoint(world, [source[index]!, source[index + 1]!, source[index + 2]!]);
          transformed[index] = point[0]; transformed[index + 1] = point[1]; transformed[index + 2] = point[2];
        }
        drawables.push({
          positions: transformed,
          indices: primitive.indices === undefined ? null : readIndices(document, bin, primitive.indices),
          color: primitiveColor(document, primitive.material)
        });
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };

  for (const root of roots) visit(root, identity());
  if (drawables.length === 0) throw new Error("GLB sem malha TRIANGLES renderizável.");
  return normalizeDrawables(drawables);
}

function normalizeDrawables(drawables: readonly Drawable[]): Drawable[] {
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (const drawable of drawables) {
    for (let index = 0; index < drawable.positions.length; index += 3) {
      const x = drawable.positions[index]!; const y = drawable.positions[index + 1]!; const z = drawable.positions[index + 2]!;
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    }
  }
  const center: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!Number.isFinite(extent) || extent <= 0) throw new Error("GLB com bounds degenerados.");
  const scale = 1.55 / extent;
  return drawables.map((drawable) => {
    const positions = new Float32Array(drawable.positions.length);
    for (let index = 0; index < drawable.positions.length; index += 3) {
      positions[index] = (drawable.positions[index]! - center[0]) * scale;
      positions[index + 1] = (drawable.positions[index + 1]! - center[1]) * scale;
      positions[index + 2] = (drawable.positions[index + 2]! - center[2]) * scale;
    }
    return { ...drawable, positions };
  });
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL não conseguiu criar shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "shader inválido";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `
    attribute vec3 a_position;
    uniform mat4 u_mvp;
    void main(){ gl_Position = u_mvp * vec4(a_position,1.0); }
  `);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec4 u_color;
    void main(){ gl_FragColor = vec4(u_color.rgb * 0.92 + vec3(0.035), u_color.a); }
  `);
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL não conseguiu criar programa.");
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "programa inválido";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function render(canvas: HTMLCanvasElement, drawables: readonly Drawable[], rotationDegrees: number): () => void {
  const gl = (canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true }) as WebGLRenderingContext | null);
  if (!gl) throw new Error("WebGL indisponível neste dispositivo.");
  const program = createProgram(gl);
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const mvpLocation = gl.getUniformLocation(program, "u_mvp");
  const colorLocation = gl.getUniformLocation(program, "u_color");
  if (positionLocation < 0 || !mvpLocation || !colorLocation) throw new Error("Shader GLB incompleto.");

  const resources = drawables.map((drawable) => {
    const positionBuffer = gl.createBuffer();
    if (!positionBuffer) throw new Error("Falha ao criar buffer de vértices.");
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, drawable.positions, gl.STATIC_DRAW);
    let indexBuffer: WebGLBuffer | null = null;
    if (drawable.indices) {
      indexBuffer = gl.createBuffer();
      if (!indexBuffer) throw new Error("Falha ao criar buffer de índices.");
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, drawable.indices, gl.STATIC_DRAW);
    }
    return { drawable, positionBuffer, indexBuffer };
  });

  const draw = () => {
    const width = Math.max(1, Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2)));
    const height = Math.max(1, Math.round(canvas.clientHeight * Math.min(window.devicePixelRatio || 1, 2)));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    const projection = perspective(Math.PI / 4.2, width / height, 0.1, 20);
    const view = lookAt([2.45, 1.65, 3.2], [0, 0, 0], [0, 1, 0]);
    const model = rotationY(rotationDegrees * Math.PI / 180);
    const mvp = multiply(projection, multiply(view, model));
    gl.uniformMatrix4fv(mvpLocation, false, new Float32Array(mvp));

    for (const resource of resources) {
      gl.bindBuffer(gl.ARRAY_BUFFER, resource.positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4fv(colorLocation, new Float32Array(resource.drawable.color));
      if (resource.drawable.indices && resource.indexBuffer) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resource.indexBuffer);
        gl.drawElements(gl.TRIANGLES, resource.drawable.indices.length, gl.UNSIGNED_INT, 0);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, resource.drawable.positions.length / 3);
      }
    }
  };

  draw();
  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  return () => {
    observer.disconnect();
    for (const resource of resources) {
      gl.deleteBuffer(resource.positionBuffer);
      if (resource.indexBuffer) gl.deleteBuffer(resource.indexBuffer);
    }
    gl.deleteProgram(program);
  };
}

export function GlbPlacement({ assetUrl, label, rotationYDegrees = 0, current = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let dispose: (() => void) | null = null;
    setState("loading"); setError(null);
    void fetch(assetUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`GLB ${response.status}`);
        const type = response.headers.get("content-type")?.split(";", 1)[0];
        if (type && type !== "model/gltf-binary" && type !== "application/octet-stream") {
          throw new Error("Content-Type GLB inesperado.");
        }
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (controller.signal.aborted) return;
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas 3D indisponível.");
        const parsed = parseGlb(buffer);
        const drawables = buildDrawables(parsed.json, parsed.bin);
        dispose = render(canvas, drawables, rotationYDegrees);
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Modelo 3D incompatível.");
        setState("error");
      });
    return () => { controller.abort(); dispose?.(); };
  }, [assetUrl, rotationYDegrees]);

  return (
    <div
      aria-label={`Modelo 3D criado por usuário: ${label}`}
      className={styles.viewport}
      data-current={current ? "true" : "false"}
      data-glb-renderer="first-party-webgl-v1"
      role="img"
      title={state === "error" ? `${label}: ${error ?? "modelo não suportado"}` : label}
    >
      <canvas aria-hidden="true" ref={canvasRef} />
      <span className={styles.badge} aria-hidden="true">GLB</span>
      {state === "loading" ? <span className={styles.loading}>carregando 3D…</span> : null}
      {state === "error" ? <span className={styles.fallback}>3D seguro<br />preview indisponível</span> : null}
    </div>
  );
}

// Tehkné Solutions
