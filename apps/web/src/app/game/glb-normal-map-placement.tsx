"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./glb-placement.module.css";
import {
  parseNormalMappedPbrGlb,
  type NormalMappedPbrDrawable
} from "./glb-normal-map-runtime";
import type { EmbeddedMaterialTexture } from "./glb-dual-texture-runtime";

type Props = Readonly<{
  assetUrl: string;
  label: string;
  rotationYDegrees?: number;
  current?: boolean;
}>;

type Vec3 = readonly [number, number, number];
type Mat4 = readonly number[];

type GpuDrawable = Readonly<{
  drawable: NormalMappedPbrDrawable;
  positionBuffer: WebGLBuffer;
  normalBuffer: WebGLBuffer;
  tangentBuffer: WebGLBuffer | null;
  texCoordBuffer: WebGLBuffer | null;
  baseColorTexture: WebGLTexture | null;
  metallicRoughnessTexture: WebGLTexture | null;
  occlusionTexture: WebGLTexture | null;
  emissiveTexture: WebGLTexture | null;
  normalTexture: WebGLTexture | null;
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
    attribute vec4 a_tangent;
    attribute vec2 a_texcoord;
    uniform mat4 u_view_projection;
    uniform mat4 u_model;
    uniform mat3 u_model_rotation;
    varying vec3 v_normal;
    varying vec4 v_tangent;
    varying vec3 v_world_position;
    varying vec2 v_texcoord;
    void main(){
      vec4 world = u_model * vec4(a_position, 1.0);
      v_world_position = world.xyz;
      v_normal = normalize(u_model_rotation * a_normal);
      v_tangent = vec4(normalize(u_model_rotation * a_tangent.xyz), a_tangent.w);
      v_texcoord = a_texcoord;
      gl_Position = u_view_projection * world;
    }
  `);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec3 v_normal;
    varying vec4 v_tangent;
    varying vec3 v_world_position;
    varying vec2 v_texcoord;
    uniform vec4 u_base_color;
    uniform float u_metallic_factor;
    uniform float u_roughness_factor;
    uniform vec3 u_emissive_factor;
    uniform float u_occlusion_strength;
    uniform float u_normal_scale;
    uniform vec3 u_light_direction;
    uniform vec3 u_camera_position;
    uniform sampler2D u_base_color_texture;
    uniform sampler2D u_metallic_roughness_texture;
    uniform sampler2D u_occlusion_texture;
    uniform sampler2D u_emissive_texture;
    uniform sampler2D u_normal_texture;
    uniform float u_has_base_color_texture;
    uniform float u_has_metallic_roughness_texture;
    uniform float u_has_occlusion_texture;
    uniform float u_has_emissive_texture;
    uniform float u_has_normal_texture;

    vec3 srgbToLinear(vec3 value){
      vec3 low = value / 12.92;
      vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));
      return mix(low, high, step(vec3(0.04045), value));
    }

    vec3 linearToSrgb(vec3 value){
      value = max(value, vec3(0.0));
      vec3 low = value * 12.92;
      vec3 high = 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055;
      return mix(low, high, step(vec3(0.0031308), value));
    }

    void main(){
      vec4 baseSample = texture2D(u_base_color_texture, v_texcoord);
      vec3 baseTextureLinear = mix(vec3(1.0), srgbToLinear(baseSample.rgb), u_has_base_color_texture);
      float baseAlpha = u_base_color.a * mix(1.0, baseSample.a, u_has_base_color_texture);
      vec3 baseColor = u_base_color.rgb * baseTextureLinear;

      vec4 mrSample = texture2D(u_metallic_roughness_texture, v_texcoord);
      float roughness = clamp(u_roughness_factor * mix(1.0, mrSample.g, u_has_metallic_roughness_texture), 0.0, 1.0);
      float metallic = clamp(u_metallic_factor * mix(1.0, mrSample.b, u_has_metallic_roughness_texture), 0.0, 1.0);

      float occlusionSample = texture2D(u_occlusion_texture, v_texcoord).r;
      float authoredOcclusion = 1.0 + u_occlusion_strength * (occlusionSample - 1.0);
      float ambientOcclusion = mix(1.0, authoredOcclusion, u_has_occlusion_texture);

      vec3 emissiveSample = texture2D(u_emissive_texture, v_texcoord).rgb;
      vec3 emissiveTextureLinear = mix(vec3(1.0), srgbToLinear(emissiveSample), u_has_emissive_texture);
      vec3 emissive = u_emissive_factor * emissiveTextureLinear;

      vec3 geometryNormal = normalize(v_normal);
      if (!gl_FrontFacing) geometryNormal = -geometryNormal;
      vec3 tangent = normalize(v_tangent.xyz - geometryNormal * dot(geometryNormal, v_tangent.xyz));
      vec3 bitangent = normalize(cross(geometryNormal, tangent)) * v_tangent.w;
      vec3 tangentNormal = texture2D(u_normal_texture, v_texcoord).rgb * 2.0 - 1.0;
      tangentNormal.xy *= u_normal_scale;
      tangentNormal = normalize(tangentNormal);
      vec3 mappedNormal = normalize(
        tangent * tangentNormal.x
        + bitangent * tangentNormal.y
        + geometryNormal * tangentNormal.z
      );
      vec3 normal = normalize(mix(geometryNormal, mappedNormal, u_has_normal_texture));

      vec3 lightDir = normalize(u_light_direction);
      vec3 viewDir = normalize(u_camera_position - v_world_position);
      vec3 halfDir = normalize(lightDir + viewDir);
      float nDotL = max(dot(normal, lightDir), 0.0);
      float nDotH = max(dot(normal, halfDir), 0.0);
      float hemisphere = 0.22 + 0.12 * (normal.y * 0.5 + 0.5);
      vec3 indirectDiffuse = baseColor * (1.0 - metallic) * hemisphere * ambientOcclusion;
      vec3 directDiffuse = baseColor * (1.0 - metallic) * 0.78 * nDotL;
      vec3 f0 = mix(vec3(0.04), baseColor, metallic);
      float specularPower = mix(96.0, 6.0, roughness);
      float specularStrength = mix(1.0, 0.18, roughness);
      vec3 directSpecular = f0 * pow(nDotH, specularPower) * specularStrength * (0.18 + 0.82 * nDotL);
      vec3 indirectBase = baseColor * 0.035 * ambientOcclusion;
      vec3 linearColor = min(indirectDiffuse + directDiffuse + directSpecular + indirectBase + emissive, vec3(1.0));
      gl_FragColor = vec4(linearToSrgb(linearColor), baseAlpha);
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

async function uploadTexture(gl: WebGLRenderingContext, descriptor: EmbeddedMaterialTexture): Promise<WebGLTexture> {
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

function createWhiteTexture(gl: WebGLRenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("WebGL não conseguiu criar texture fallback.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

async function renderNormalMappedPbr(canvas: HTMLCanvasElement, drawables: readonly NormalMappedPbrDrawable[], rotationDegrees: number): Promise<() => void> {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true }) as WebGLRenderingContext | null;
  if (!gl) throw new Error("WebGL indisponível neste dispositivo.");
  if (Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)) < 5) throw new Error("GPU não oferece cinco texture units para o perfil normal-map v7.");
  const program = createProgram(gl);

  const positionLocation = gl.getAttribLocation(program, "a_position");
  const normalLocation = gl.getAttribLocation(program, "a_normal");
  const tangentLocation = gl.getAttribLocation(program, "a_tangent");
  const texCoordLocation = gl.getAttribLocation(program, "a_texcoord");
  const viewProjectionLocation = gl.getUniformLocation(program, "u_view_projection");
  const modelLocation = gl.getUniformLocation(program, "u_model");
  const modelRotationLocation = gl.getUniformLocation(program, "u_model_rotation");
  const baseColorLocation = gl.getUniformLocation(program, "u_base_color");
  const metallicFactorLocation = gl.getUniformLocation(program, "u_metallic_factor");
  const roughnessFactorLocation = gl.getUniformLocation(program, "u_roughness_factor");
  const emissiveFactorLocation = gl.getUniformLocation(program, "u_emissive_factor");
  const occlusionStrengthLocation = gl.getUniformLocation(program, "u_occlusion_strength");
  const normalScaleLocation = gl.getUniformLocation(program, "u_normal_scale");
  const lightLocation = gl.getUniformLocation(program, "u_light_direction");
  const cameraLocation = gl.getUniformLocation(program, "u_camera_position");
  const baseTextureLocation = gl.getUniformLocation(program, "u_base_color_texture");
  const mrTextureLocation = gl.getUniformLocation(program, "u_metallic_roughness_texture");
  const occlusionTextureLocation = gl.getUniformLocation(program, "u_occlusion_texture");
  const emissiveTextureLocation = gl.getUniformLocation(program, "u_emissive_texture");
  const normalTextureLocation = gl.getUniformLocation(program, "u_normal_texture");
  const hasBaseTextureLocation = gl.getUniformLocation(program, "u_has_base_color_texture");
  const hasMrTextureLocation = gl.getUniformLocation(program, "u_has_metallic_roughness_texture");
  const hasOcclusionTextureLocation = gl.getUniformLocation(program, "u_has_occlusion_texture");
  const hasEmissiveTextureLocation = gl.getUniformLocation(program, "u_has_emissive_texture");
  const hasNormalTextureLocation = gl.getUniformLocation(program, "u_has_normal_texture");
  if (
    positionLocation < 0 || normalLocation < 0 || tangentLocation < 0 || texCoordLocation < 0
    || !viewProjectionLocation || !modelLocation || !modelRotationLocation || !baseColorLocation
    || !metallicFactorLocation || !roughnessFactorLocation || !emissiveFactorLocation || !occlusionStrengthLocation
    || !normalScaleLocation || !lightLocation || !cameraLocation || !baseTextureLocation || !mrTextureLocation
    || !occlusionTextureLocation || !emissiveTextureLocation || !normalTextureLocation || !hasBaseTextureLocation
    || !hasMrTextureLocation || !hasOcclusionTextureLocation || !hasEmissiveTextureLocation || !hasNormalTextureLocation
  ) {
    gl.deleteProgram(program);
    throw new Error("Shader GLB normal-map-v7 incompleto.");
  }

  const whiteTexture = createWhiteTexture(gl);
  const texturePromises = new Map<number, Promise<WebGLTexture>>();
  const gpuTextures = new Set<WebGLTexture>();
  const resolveTexture = async (descriptor: EmbeddedMaterialTexture | null): Promise<WebGLTexture | null> => {
    if (!descriptor) return null;
    let pending = texturePromises.get(descriptor.textureIndex);
    if (!pending) {
      pending = uploadTexture(gl, descriptor).then((texture) => {
        gpuTextures.add(texture);
        return texture;
      });
      texturePromises.set(descriptor.textureIndex, pending);
    }
    return pending;
  };

  const resources: GpuDrawable[] = [];
  try {
    for (const drawable of drawables) {
      const positionBuffer = gl.createBuffer();
      const normalBuffer = gl.createBuffer();
      if (!positionBuffer || !normalBuffer) throw new Error("Falha ao criar buffers normal-map-v7.");
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, drawable.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, drawable.normals, gl.STATIC_DRAW);

      let tangentBuffer: WebGLBuffer | null = null;
      if (drawable.tangents) {
        tangentBuffer = gl.createBuffer();
        if (!tangentBuffer) throw new Error("Falha ao criar buffer TANGENT.");
        gl.bindBuffer(gl.ARRAY_BUFFER, tangentBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, drawable.tangents, gl.STATIC_DRAW);
      }

      let texCoordBuffer: WebGLBuffer | null = null;
      if (drawable.texCoords) {
        texCoordBuffer = gl.createBuffer();
        if (!texCoordBuffer) throw new Error("Falha ao criar buffer TEXCOORD_0.");
        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, drawable.texCoords, gl.STATIC_DRAW);
      }

      const [baseColorTexture, metallicRoughnessTexture, occlusionTexture, emissiveTexture, normalTexture] = await Promise.all([
        resolveTexture(drawable.baseColorTexture),
        resolveTexture(drawable.metallicRoughnessTexture),
        resolveTexture(drawable.occlusionTexture),
        resolveTexture(drawable.emissiveTexture),
        resolveTexture(drawable.normalTexture)
      ]);
      resources.push({
        drawable,
        positionBuffer,
        normalBuffer,
        tangentBuffer,
        texCoordBuffer,
        baseColorTexture,
        metallicRoughnessTexture,
        occlusionTexture,
        emissiveTexture,
        normalTexture
      });
    }
  } catch (error) {
    for (const resource of resources) {
      gl.deleteBuffer(resource.positionBuffer);
      gl.deleteBuffer(resource.normalBuffer);
      if (resource.tangentBuffer) gl.deleteBuffer(resource.tangentBuffer);
      if (resource.texCoordBuffer) gl.deleteBuffer(resource.texCoordBuffer);
    }
    for (const texture of gpuTextures) gl.deleteTexture(texture);
    gl.deleteTexture(whiteTexture);
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
    gl.uniform1i(baseTextureLocation, 0);
    gl.uniform1i(mrTextureLocation, 1);
    gl.uniform1i(occlusionTextureLocation, 2);
    gl.uniform1i(emissiveTextureLocation, 3);
    gl.uniform1i(normalTextureLocation, 4);

    for (const resource of resources) {
      if (resource.drawable.doubleSided) gl.disable(gl.CULL_FACE);
      else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }

      gl.bindBuffer(gl.ARRAY_BUFFER, resource.positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resource.normalBuffer);
      gl.enableVertexAttribArray(normalLocation);
      gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);

      if (resource.tangentBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, resource.tangentBuffer);
        gl.enableVertexAttribArray(tangentLocation);
        gl.vertexAttribPointer(tangentLocation, 4, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(tangentLocation);
        gl.vertexAttrib4f(tangentLocation, 1, 0, 0, 1);
      }
      if (resource.texCoordBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, resource.texCoordBuffer);
        gl.enableVertexAttribArray(texCoordLocation);
        gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(texCoordLocation);
        gl.vertexAttrib2f(texCoordLocation, 0, 0);
      }

      const textures: readonly (WebGLTexture | null)[] = [
        resource.baseColorTexture,
        resource.metallicRoughnessTexture,
        resource.occlusionTexture,
        resource.emissiveTexture,
        resource.normalTexture
      ];
      textures.forEach((texture, textureUnit) => {
        gl.activeTexture(gl.TEXTURE0 + textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, texture ?? whiteTexture);
      });

      gl.uniform1f(hasBaseTextureLocation, resource.baseColorTexture ? 1 : 0);
      gl.uniform1f(hasMrTextureLocation, resource.metallicRoughnessTexture ? 1 : 0);
      gl.uniform1f(hasOcclusionTextureLocation, resource.occlusionTexture ? 1 : 0);
      gl.uniform1f(hasEmissiveTextureLocation, resource.emissiveTexture ? 1 : 0);
      gl.uniform1f(hasNormalTextureLocation, resource.normalTexture ? 1 : 0);
      gl.uniform4fv(baseColorLocation, new Float32Array(resource.drawable.color));
      gl.uniform1f(metallicFactorLocation, resource.drawable.metallic);
      gl.uniform1f(roughnessFactorLocation, resource.drawable.roughness);
      gl.uniform3fv(emissiveFactorLocation, new Float32Array(resource.drawable.emissive));
      gl.uniform1f(occlusionStrengthLocation, resource.drawable.occlusionStrength);
      gl.uniform1f(normalScaleLocation, resource.drawable.normalScale);
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
      if (resource.tangentBuffer) gl.deleteBuffer(resource.tangentBuffer);
      if (resource.texCoordBuffer) gl.deleteBuffer(resource.texCoordBuffer);
    }
    for (const texture of gpuTextures) gl.deleteTexture(texture);
    gl.deleteTexture(whiteTexture);
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
        const model = parseNormalMappedPbrGlb(buffer);
        const cleanup = await renderNormalMappedPbr(canvas, model.drawables, rotationYDegrees);
        if (controller.signal.aborted) { cleanup(); return; }
        dispose = cleanup;
        setMaterialState(
          model.normalMappedMaterials > 0
            ? "normal-mapped"
            : model.emissiveTexturedMaterials > 0 && model.occlusionTexturedMaterials > 0
              ? "ambient-emissive-textured"
              : model.emissiveTexturedMaterials > 0
                ? "emissive-textured"
                : model.occlusionTexturedMaterials > 0
                  ? "occlusion-textured"
                  : model.metallicRoughnessTexturedMaterials > 0
                    ? "metallic-roughness-textured"
                    : model.baseColorTexturedMaterials > 0
                      ? "base-color-textured"
                      : "numeric-pbr"
        );
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Modelo 3D/normal map incompatível.");
        setState("error");
      });
    return () => { controller.abort(); dispose?.(); };
  }, [assetUrl, rotationYDegrees]);

  return (
    <div
      aria-label={`Modelo 3D criado por usuário: ${label}`}
      className={styles.viewport}
      data-current={current ? "true" : "false"}
      data-glb-renderer="first-party-webgl-pbr-normal-map-v7"
      data-material-state={materialState}
      role="img"
      title={state === "error" ? `${label}: ${error ?? "modelo não suportado"}` : `${label} · PBR + tangent-space normal map`}
    >
      <canvas aria-hidden="true" ref={canvasRef} />
      <span className={styles.badge} aria-hidden="true">GLB · PBR+N</span>
      {state === "loading" ? <span className={styles.loading}>materializando relevo 3D…</span> : null}
      {state === "error" ? <span className={styles.fallback}>3D seguro<br />normal map indisponível</span> : null}
    </div>
  );
}

// Tehkné Solutions
