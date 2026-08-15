"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./glb-placement.module.css";
import { parseTexturedPbrGlb, type EmbeddedBaseColorTexture, type TexturedPbrDrawable } from "./glb-textured-runtime";

type Props = Readonly<{
  assetUrl: string;
  label: string;
  rotationYDegrees?: number;
  current?: boolean;
}>;

type Vec3 = readonly [number, number, number];
type Mat4 = readonly number[];

type GpuDrawable = Readonly<{
  drawable: TexturedPbrDrawable;
  positionBuffer: WebGLBuffer;
  normalBuffer: WebGLBuffer;
  texCoordBuffer: WebGLBuffer | null;
  texture: WebGLTexture | null;
}>;

function multiply(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row]! * b[column * 4]!
        + a[4 + row]! * b[column * 4 + 1]!
        + a[8 + row]! * b[column * 4 + 2]!
        + a[12 + row]! * b[column * 4 + 3]!;
    }
  }
  return out;
}

function rotationY(radians: number): number[] {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function rotationY3(radians: number): Float32Array {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return new Float32Array([c, 0, -s, 0, 1, 0, s, 0, c]);
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

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
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
    attribute vec3 a_normal;
    attribute vec2 a_texcoord;
    uniform mat4 u_view_projection;
    uniform mat4 u_model;
    uniform mat3 u_model_rotation;
    varying vec3 v_normal;
    varying vec3 v_world_position;
    varying vec2 v_texcoord;
    void main(){
      vec4 world = u_model * vec4(a_position, 1.0);
      v_world_position = world.xyz;
      v_normal = normalize(u_model_rotation * a_normal);
      v_texcoord = a_texcoord;
      gl_Position = u_view_projection * world;
    }
  `);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec3 v_normal;
    varying vec3 v_world_position;
    varying vec2 v_texcoord;
    uniform vec4 u_base_color;
    uniform float u_metallic;
    uniform float u_roughness;
    uniform vec3 u_emissive;
    uniform vec3 u_light_direction;
    uniform vec3 u_camera_position;
    uniform sampler2D u_base_color_texture;
    uniform float u_has_base_color_texture;
    void main(){
      vec4 sampled = mix(vec4(1.0), texture2D(u_base_color_texture, v_texcoord), u_has_base_color_texture);
      vec4 base = u_base_color * sampled;
      vec3 normal = normalize(v_normal);
      if (!gl_FrontFacing) normal = -normal;
      vec3 lightDir = normalize(u_light_direction);
      vec3 viewDir = normalize(u_camera_position - v_world_position);
      vec3 halfDir = normalize(lightDir + viewDir);
      float nDotL = max(dot(normal, lightDir), 0.0);
      float nDotH = max(dot(normal, halfDir), 0.0);
      float hemisphere = 0.22 + 0.12 * (normal.y * 0.5 + 0.5);
      vec3 diffuse = base.rgb * (1.0 - u_metallic) * (hemisphere + 0.78 * nDotL);
      vec3 f0 = mix(vec3(0.04), base.rgb, u_metallic);
      float specularPower = mix(96.0, 6.0, u_roughness);
      float specularStrength = mix(1.0, 0.18, u_roughness);
      vec3 specular = f0 * pow(nDotH, specularPower) * specularStrength * (0.18 + 0.82 * nDotL);
      vec3 color = diffuse + specular + u_emissive + base.rgb * 0.035;
      gl_FragColor = vec4(min(color, vec3(1.0)), base.a);
    }
  `);
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL não conseguiu criar programa.");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "programa inválido";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function powerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function glWrap(gl: WebGLRenderingContext, value: number): number {
  if (value === 33071) return gl.CLAMP_TO_EDGE;
  if (value === 33648) return gl.MIRRORED_REPEAT;
  return gl.REPEAT;
}

function glMagFilter(gl: WebGLRenderingContext, value: number): number {
  return value === 9728 ? gl.NEAREST : gl.LINEAR;
}

function glMinFilter(gl: WebGLRenderingContext, value: number): number {
  if (value === 9728) return gl.NEAREST;
  if (value === 9729) return gl.LINEAR;
  if (value === 9984) return gl.NEAREST_MIPMAP_NEAREST;
  if (value === 9985) return gl.LINEAR_MIPMAP_NEAREST;
  if (value === 9986) return gl.NEAREST_MIPMAP_LINEAR;
  return gl.LINEAR_MIPMAP_LINEAR;
}

function needsMipmaps(value: number): boolean {
  return value >= 9984 && value <= 9987;
}

async function uploadTexture(gl: WebGLRenderingContext, descriptor: EmbeddedBaseColorTexture): Promise<WebGLTexture> {
  if (typeof createImageBitmap !== "function") throw new Error("createImageBitmap indisponível para texture GLB.");
  const safeBytes = new Uint8Array(descriptor.bytes.byteLength);
  safeBytes.set(descriptor.bytes);
  const bitmap = await createImageBitmap(new Blob([safeBytes], { type: descriptor.mimeType }));
  const texture = gl.createTexture();
  if (!texture) {
    bitmap.close();
    throw new Error("WebGL não conseguiu criar texture GLB.");
  }
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    const pot = powerOfTwo(bitmap.width) && powerOfTwo(bitmap.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, glMagFilter(gl, descriptor.sampler.magFilter));
    if (pot) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, glMinFilter(gl, descriptor.sampler.minFilter));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, glWrap(gl, descriptor.sampler.wrapS));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, glWrap(gl, descriptor.sampler.wrapT));
      if (needsMipmaps(descriptor.sampler.minFilter)) gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, descriptor.sampler.minFilter === 9728 ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return texture;
  } catch (error) {
    gl.deleteTexture(texture);
    throw error;
  } finally {
    bitmap.close();
  }
}

async function renderTexturedPbr(canvas: HTMLCanvasElement, drawables: readonly TexturedPbrDrawable[], rotationDegrees: number): Promise<() => void> {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true }) as WebGLRenderingContext | null;
  if (!gl) throw new Error("WebGL indisponível neste dispositivo.");
  const program = createProgram(gl);
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const normalLocation = gl.getAttribLocation(program, "a_normal");
  const texCoordLocation = gl.getAttribLocation(program, "a_texcoord");
  const viewProjectionLocation = gl.getUniformLocation(program, "u_view_projection");
  const modelLocation = gl.getUniformLocation(program, "u_model");
  const modelRotationLocation = gl.getUniformLocation(program, "u_model_rotation");
  const baseColorLocation = gl.getUniformLocation(program, "u_base_color");
  const metallicLocation = gl.getUniformLocation(program, "u_metallic");
  const roughnessLocation = gl.getUniformLocation(program, "u_roughness");
  const emissiveLocation = gl.getUniformLocation(program, "u_emissive");
  const lightLocation = gl.getUniformLocation(program, "u_light_direction");
  const cameraLocation = gl.getUniformLocation(program, "u_camera_position");
  const textureLocation = gl.getUniformLocation(program, "u_base_color_texture");
  const hasTextureLocation = gl.getUniformLocation(program, "u_has_base_color_texture");
  if (
    positionLocation < 0 || normalLocation < 0 || texCoordLocation < 0 || !viewProjectionLocation || !modelLocation || !modelRotationLocation
    || !baseColorLocation || !metallicLocation || !roughnessLocation || !emissiveLocation || !lightLocation || !cameraLocation
    || !textureLocation || !hasTextureLocation
  ) {
    gl.deleteProgram(program);
    throw new Error("Shader GLB textured-v4 incompleto.");
  }

  const resources: GpuDrawable[] = [];
  try {
    for (const drawable of drawables) {
      const positionBuffer = gl.createBuffer();
      const normalBuffer = gl.createBuffer();
      if (!positionBuffer || !normalBuffer) throw new Error("Falha ao criar buffers textured-v4.");
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, drawable.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, drawable.normals, gl.STATIC_DRAW);

      let texCoordBuffer: WebGLBuffer | null = null;
      if (drawable.texCoords) {
        texCoordBuffer = gl.createBuffer();
        if (!texCoordBuffer) throw new Error("Falha ao criar buffer TEXCOORD_0.");
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, drawable.texCoords, gl.STATIC_DRAW);
      }
      const texture = drawable.baseColorTexture ? await uploadTexture(gl, drawable.baseColorTexture) : null;
      resources.push({ drawable, positionBuffer, normalBuffer, texCoordBuffer, texture });
    }
  } catch (error) {
    for (const resource of resources) {
      gl.deleteBuffer(resource.positionBuffer);
      gl.deleteBuffer(resource.normalBuffer);
      if (resource.texCoordBuffer) gl.deleteBuffer(resource.texCoordBuffer);
      if (resource.texture) gl.deleteTexture(resource.texture);
    }
    gl.deleteProgram(program);
    throw error;
  }

  const radians = rotationDegrees * Math.PI / 180;
  const model = rotationY(radians);
  const modelRotation = rotationY3(radians);
  const camera: Vec3 = [2.45, 1.65, 3.2];
  const view = lookAt(camera, [0, 0, 0], [0, 1, 0]);
  const lightDirection = new Float32Array(normalize([0.48, 0.82, 0.52]));
  const cameraPosition = new Float32Array(camera);

  const draw = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);

    const projection = perspective(Math.PI / 4.2, width / height, 0.1, 20);
    gl.uniformMatrix4fv(viewProjectionLocation, false, new Float32Array(multiply(projection, view)));
    gl.uniformMatrix4fv(modelLocation, false, new Float32Array(model));
    gl.uniformMatrix3fv(modelRotationLocation, false, modelRotation);
    gl.uniform3fv(lightLocation, lightDirection);
    gl.uniform3fv(cameraLocation, cameraPosition);
    gl.uniform1i(textureLocation, 0);

    for (const resource of resources) {
      if (resource.drawable.doubleSided) gl.disable(gl.CULL_FACE);
      else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
      gl.bindBuffer(gl.ARRAY_BUFFER, resource.positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resource.normalBuffer);
      gl.enableVertexAttribArray(normalLocation);
      gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);
      if (resource.texCoordBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, resource.texCoordBuffer);
        gl.enableVertexAttribArray(texCoordLocation);
        gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(texCoordLocation);
        gl.vertexAttrib2f(texCoordLocation, 0, 0);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, resource.texture);
      gl.uniform1f(hasTextureLocation, resource.texture ? 1 : 0);
      gl.uniform4fv(baseColorLocation, new Float32Array(resource.drawable.color));
      gl.uniform1f(metallicLocation, resource.drawable.metallic);
      gl.uniform1f(roughnessLocation, resource.drawable.roughness);
      gl.uniform3fv(emissiveLocation, new Float32Array(resource.drawable.emissive));
      gl.drawArrays(gl.TRIANGLES, 0, resource.drawable.positions.length / 3);
    }
  };

  draw();
  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  return () => {
    observer.disconnect();
    for (const resource of resources) {
      gl.deleteBuffer(resource.positionBuffer);
      gl.deleteBuffer(resource.normalBuffer);
      if (resource.texCoordBuffer) gl.deleteBuffer(resource.texCoordBuffer);
      if (resource.texture) gl.deleteTexture(resource.texture);
    }
    gl.deleteProgram(program);
  };
}

export function GlbPlacement({ assetUrl, label, rotationYDegrees = 0, current = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [materialState, setMaterialState] = useState("pending");

  useEffect(() => {
    const controller = new AbortController();
    let dispose: (() => void) | null = null;
    setState("loading"); setError(null); setMaterialState("pending");
    void fetch(assetUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`GLB ${response.status}`);
        const type = response.headers.get("content-type")?.split(";", 1)[0];
        if (type && type !== "model/gltf-binary" && type !== "application/octet-stream") throw new Error("Content-Type GLB inesperado.");
        return response.arrayBuffer();
      })
      .then(async (buffer) => {
        if (controller.signal.aborted) return;
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas 3D indisponível.");
        const model = parseTexturedPbrGlb(buffer);
        const cleanup = await renderTexturedPbr(canvas, model.drawables, rotationYDegrees);
        if (controller.signal.aborted) { cleanup(); return; }
        dispose = cleanup;
        setMaterialState(model.texturedMaterials > 0 ? "textured" : model.emissiveMaterials > 0 ? "emissive" : model.metallicMaterials > 0 ? "metallic" : "matte");
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Modelo 3D/textura incompatível.");
        setState("error");
      });
    return () => { controller.abort(); dispose?.(); };
  }, [assetUrl, rotationYDegrees]);

  return (
    <div
      aria-label={`Modelo 3D criado por usuário: ${label}`}
      className={styles.viewport}
      data-current={current ? "true" : "false"}
      data-glb-renderer="first-party-webgl-pbr-textured-v4"
      data-material-state={materialState}
      role="img"
      title={state === "error" ? `${label}: ${error ?? "modelo não suportado"}` : `${label} · PBR + baseColorTexture embutida`}
    >
      <canvas aria-hidden="true" ref={canvasRef} />
      <span className={styles.badge} aria-hidden="true">GLB · PBR+TEX</span>
      {state === "loading" ? <span className={styles.loading}>materializando textura 3D…</span> : null}
      {state === "error" ? <span className={styles.fallback}>3D seguro<br />textura indisponível</span> : null}
    </div>
  );
}

// Tehkné Solutions
