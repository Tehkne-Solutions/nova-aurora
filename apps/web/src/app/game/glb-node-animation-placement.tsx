"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./glb-placement.module.css";
import { parseAlphaBlendPbrGlb, type AlphaBlendPbrDrawable, type AlphaBlendPbrModel } from "./glb-alpha-blend-runtime";
import type { EmbeddedMaterialTexture } from "./glb-dual-texture-runtime";
import {
  animatedNormalizedDelta,
  computeAnimationNormalization,
  normalMatrix3,
  transformPoint,
  type AnimationNormalization
} from "./glb-node-animation-delta";
import { multiply4, type Mat4, type NodeAnimationRuntimeModel, type Vec3 } from "./glb-node-animation-runtime";
import {
  parseCertifiedNodeAnimationRuntime,
  sampleCertifiedNodeWorldMatrices
} from "./glb-node-animation-sampling";

type Props = Readonly<{
  assetUrl: string;
  label: string;
  rotationYDegrees?: number;
  current?: boolean;
}>;

type GpuDrawable = Readonly<{
  index: number;
  drawable: AlphaBlendPbrDrawable;
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

type ShaderBindings = Readonly<{
  positionLocation: number;
  normalLocation: number;
  tangentLocation: number;
  texCoordLocation: number;
  viewProjectionLocation: WebGLUniformLocation;
  modelLocation: WebGLUniformLocation;
  normalMatrixLocation: WebGLUniformLocation;
  directionMatrixLocation: WebGLUniformLocation;
  tangentHandednessLocation: WebGLUniformLocation;
  baseColorLocation: WebGLUniformLocation;
  metallicFactorLocation: WebGLUniformLocation;
  roughnessFactorLocation: WebGLUniformLocation;
  emissiveFactorLocation: WebGLUniformLocation;
  occlusionStrengthLocation: WebGLUniformLocation;
  normalScaleLocation: WebGLUniformLocation;
  alphaMaskLocation: WebGLUniformLocation;
  alphaBlendLocation: WebGLUniformLocation;
  alphaCutoffLocation: WebGLUniformLocation;
  lightLocation: WebGLUniformLocation;
  cameraLocation: WebGLUniformLocation;
  baseTextureLocation: WebGLUniformLocation;
  mrTextureLocation: WebGLUniformLocation;
  occlusionTextureLocation: WebGLUniformLocation;
  emissiveTextureLocation: WebGLUniformLocation;
  normalTextureLocation: WebGLUniformLocation;
  hasBaseTextureLocation: WebGLUniformLocation;
  hasMrTextureLocation: WebGLUniformLocation;
  hasOcclusionTextureLocation: WebGLUniformLocation;
  hasEmissiveTextureLocation: WebGLUniformLocation;
  hasNormalTextureLocation: WebGLUniformLocation;
}>;

function rotationY(radians: number): Mat4 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function topLeft3(matrix: Mat4): Float32Array {
  return new Float32Array([
    matrix[0]!, matrix[1]!, matrix[2]!,
    matrix[4]!, matrix[5]!, matrix[6]!,
    matrix[8]!, matrix[9]!, matrix[10]!
  ]);
}

function determinant3(matrix: Mat4): number {
  const a = matrix[0]!; const b = matrix[4]!; const c = matrix[8]!;
  const d = matrix[1]!; const e = matrix[5]!; const f = matrix[9]!;
  const g = matrix[2]!; const h = matrix[6]!; const i = matrix[10]!;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

function perspective(fovRadians: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovRadians / 2);
  const nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
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

function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
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

function distanceSquared(point: Vec3, camera: Vec3): number {
  const dx = point[0] - camera[0]; const dy = point[1] - camera[1]; const dz = point[2] - camera[2];
  return dx * dx + dy * dy + dz * dz;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL não conseguiu criar shader animado.");
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
    uniform mat3 u_normal_matrix;
    uniform mat3 u_direction_matrix;
    uniform float u_tangent_handedness;
    varying vec3 v_normal;
    varying vec4 v_tangent;
    varying vec3 v_world_position;
    varying vec2 v_texcoord;
    void main(){
      vec4 world = u_model * vec4(a_position, 1.0);
      v_world_position = world.xyz;
      v_normal = normalize(u_normal_matrix * a_normal);
      v_tangent = vec4(normalize(u_direction_matrix * a_tangent.xyz), a_tangent.w * u_tangent_handedness);
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
    uniform float u_alpha_mask;
    uniform float u_alpha_blend;
    uniform float u_alpha_cutoff;
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
      float materialAlpha = u_base_color.a * mix(1.0, baseSample.a, u_has_base_color_texture);
      if (u_alpha_mask > 0.5 && materialAlpha < u_alpha_cutoff) discard;
      vec3 baseTextureLinear = mix(vec3(1.0), srgbToLinear(baseSample.rgb), u_has_base_color_texture);
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
      vec3 mappedNormal = normalize(tangent * tangentNormal.x + bitangent * tangentNormal.y + geometryNormal * tangentNormal.z);
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
      float outputAlpha = mix(1.0, materialAlpha, u_alpha_blend);
      gl_FragColor = vec4(linearToSrgb(linearColor), outputAlpha);
    }
  `);
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL não conseguiu criar programa animado.");
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

function requiredUniform(gl: WebGLRenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`Shader GLB node-animation-v10 não expôs ${name}.`);
  return location;
}

function shaderBindings(gl: WebGLRenderingContext, program: WebGLProgram): ShaderBindings {
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const normalLocation = gl.getAttribLocation(program, "a_normal");
  const tangentLocation = gl.getAttribLocation(program, "a_tangent");
  const texCoordLocation = gl.getAttribLocation(program, "a_texcoord");
  if ([positionLocation, normalLocation, tangentLocation, texCoordLocation].some((value) => value < 0)) {
    throw new Error("Shader GLB node-animation-v10 não expôs todos os atributos.");
  }
  return {
    positionLocation, normalLocation, tangentLocation, texCoordLocation,
    viewProjectionLocation: requiredUniform(gl, program, "u_view_projection"),
    modelLocation: requiredUniform(gl, program, "u_model"),
    normalMatrixLocation: requiredUniform(gl, program, "u_normal_matrix"),
    directionMatrixLocation: requiredUniform(gl, program, "u_direction_matrix"),
    tangentHandednessLocation: requiredUniform(gl, program, "u_tangent_handedness"),
    baseColorLocation: requiredUniform(gl, program, "u_base_color"),
    metallicFactorLocation: requiredUniform(gl, program, "u_metallic_factor"),
    roughnessFactorLocation: requiredUniform(gl, program, "u_roughness_factor"),
    emissiveFactorLocation: requiredUniform(gl, program, "u_emissive_factor"),
    occlusionStrengthLocation: requiredUniform(gl, program, "u_occlusion_strength"),
    normalScaleLocation: requiredUniform(gl, program, "u_normal_scale"),
    alphaMaskLocation: requiredUniform(gl, program, "u_alpha_mask"),
    alphaBlendLocation: requiredUniform(gl, program, "u_alpha_blend"),
    alphaCutoffLocation: requiredUniform(gl, program, "u_alpha_cutoff"),
    lightLocation: requiredUniform(gl, program, "u_light_direction"),
    cameraLocation: requiredUniform(gl, program, "u_camera_position"),
    baseTextureLocation: requiredUniform(gl, program, "u_base_color_texture"),
    mrTextureLocation: requiredUniform(gl, program, "u_metallic_roughness_texture"),
    occlusionTextureLocation: requiredUniform(gl, program, "u_occlusion_texture"),
    emissiveTextureLocation: requiredUniform(gl, program, "u_emissive_texture"),
    normalTextureLocation: requiredUniform(gl, program, "u_normal_texture"),
    hasBaseTextureLocation: requiredUniform(gl, program, "u_has_base_color_texture"),
    hasMrTextureLocation: requiredUniform(gl, program, "u_has_metallic_roughness_texture"),
    hasOcclusionTextureLocation: requiredUniform(gl, program, "u_has_occlusion_texture"),
    hasEmissiveTextureLocation: requiredUniform(gl, program, "u_has_emissive_texture"),
    hasNormalTextureLocation: requiredUniform(gl, program, "u_has_normal_texture")
  };
}

function powerOfTwo(value: number): boolean { return value > 0 && (value & (value - 1)) === 0; }
function glWrap(gl: WebGLRenderingContext, value: number): number {
  if (value === 33071) return gl.CLAMP_TO_EDGE;
  if (value === 33648) return gl.MIRRORED_REPEAT;
  return gl.REPEAT;
}
function glMagFilter(gl: WebGLRenderingContext, value: number): number { return value === 9728 ? gl.NEAREST : gl.LINEAR; }
function glMinFilter(gl: WebGLRenderingContext, value: number): number {
  if (value === 9728) return gl.NEAREST;
  if (value === 9729) return gl.LINEAR;
  if (value === 9984) return gl.NEAREST_MIPMAP_NEAREST;
  if (value === 9985) return gl.LINEAR_MIPMAP_NEAREST;
  if (value === 9986) return gl.NEAREST_MIPMAP_LINEAR;
  return gl.LINEAR_MIPMAP_LINEAR;
}
function needsMipmaps(value: number): boolean { return value >= 9984 && value <= 9987; }

async function uploadTexture(gl: WebGLRenderingContext, descriptor: EmbeddedMaterialTexture): Promise<WebGLTexture> {
  if (typeof createImageBitmap !== "function") throw new Error("createImageBitmap indisponível para texture GLB.");
  const safeBytes = new Uint8Array(descriptor.bytes.byteLength);
  safeBytes.set(descriptor.bytes);
  const bitmap = await createImageBitmap(new Blob([safeBytes], { type: descriptor.mimeType }));
  const texture = gl.createTexture();
  if (!texture) { bitmap.close(); throw new Error("WebGL não conseguiu criar texture GLB."); }
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
  } finally { bitmap.close(); }
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

function bindMaterial(gl: WebGLRenderingContext, bindings: ShaderBindings, resource: GpuDrawable, whiteTexture: WebGLTexture): void {
  if (resource.drawable.doubleSided) gl.disable(gl.CULL_FACE);
  else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
  gl.bindBuffer(gl.ARRAY_BUFFER, resource.positionBuffer);
  gl.enableVertexAttribArray(bindings.positionLocation);
  gl.vertexAttribPointer(bindings.positionLocation, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, resource.normalBuffer);
  gl.enableVertexAttribArray(bindings.normalLocation);
  gl.vertexAttribPointer(bindings.normalLocation, 3, gl.FLOAT, false, 0, 0);
  if (resource.tangentBuffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, resource.tangentBuffer);
    gl.enableVertexAttribArray(bindings.tangentLocation);
    gl.vertexAttribPointer(bindings.tangentLocation, 4, gl.FLOAT, false, 0, 0);
  } else {
    gl.disableVertexAttribArray(bindings.tangentLocation);
    gl.vertexAttrib4f(bindings.tangentLocation, 1, 0, 0, 1);
  }
  if (resource.texCoordBuffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, resource.texCoordBuffer);
    gl.enableVertexAttribArray(bindings.texCoordLocation);
    gl.vertexAttribPointer(bindings.texCoordLocation, 2, gl.FLOAT, false, 0, 0);
  } else {
    gl.disableVertexAttribArray(bindings.texCoordLocation);
    gl.vertexAttrib2f(bindings.texCoordLocation, 0, 0);
  }
  const textures: readonly (WebGLTexture | null)[] = [resource.baseColorTexture, resource.metallicRoughnessTexture, resource.occlusionTexture, resource.emissiveTexture, resource.normalTexture];
  textures.forEach((texture, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture ?? whiteTexture); });
  gl.uniform1f(bindings.hasBaseTextureLocation, resource.baseColorTexture ? 1 : 0);
  gl.uniform1f(bindings.hasMrTextureLocation, resource.metallicRoughnessTexture ? 1 : 0);
  gl.uniform1f(bindings.hasOcclusionTextureLocation, resource.occlusionTexture ? 1 : 0);
  gl.uniform1f(bindings.hasEmissiveTextureLocation, resource.emissiveTexture ? 1 : 0);
  gl.uniform1f(bindings.hasNormalTextureLocation, resource.normalTexture ? 1 : 0);
  gl.uniform1f(bindings.alphaMaskLocation, resource.drawable.alphaMode === "MASK" ? 1 : 0);
  gl.uniform1f(bindings.alphaBlendLocation, resource.drawable.alphaMode === "BLEND" ? 1 : 0);
  gl.uniform1f(bindings.alphaCutoffLocation, resource.drawable.alphaCutoff);
  gl.uniform4fv(bindings.baseColorLocation, new Float32Array(resource.drawable.color));
  gl.uniform1f(bindings.metallicFactorLocation, resource.drawable.metallic);
  gl.uniform1f(bindings.roughnessFactorLocation, resource.drawable.roughness);
  gl.uniform3fv(bindings.emissiveFactorLocation, new Float32Array(resource.drawable.emissive));
  gl.uniform1f(bindings.occlusionStrengthLocation, resource.drawable.occlusionStrength);
  gl.uniform1f(bindings.normalScaleLocation, resource.drawable.normalScale);
}

async function createGpuResources(gl: WebGLRenderingContext, drawables: readonly AlphaBlendPbrDrawable[], whiteTexture: WebGLTexture): Promise<Readonly<{ resources: GpuDrawable[]; gpuTextures: Set<WebGLTexture> }>> {
  const texturePromises = new Map<number, Promise<WebGLTexture>>();
  const gpuTextures = new Set<WebGLTexture>();
  const resolveTexture = async (descriptor: EmbeddedMaterialTexture | null): Promise<WebGLTexture | null> => {
    if (!descriptor) return null;
    let pending = texturePromises.get(descriptor.textureIndex);
    if (!pending) {
      pending = uploadTexture(gl, descriptor).then((texture) => { gpuTextures.add(texture); return texture; });
      texturePromises.set(descriptor.textureIndex, pending);
    }
    return pending;
  };
  const resources: GpuDrawable[] = [];
  try {
    for (const [index, drawable] of drawables.entries()) {
      const positionBuffer = gl.createBuffer(); const normalBuffer = gl.createBuffer();
      if (!positionBuffer || !normalBuffer) throw new Error("Falha ao criar buffers node-animation-v10.");
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer); gl.bufferData(gl.ARRAY_BUFFER, drawable.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer); gl.bufferData(gl.ARRAY_BUFFER, drawable.normals, gl.STATIC_DRAW);
      let tangentBuffer: WebGLBuffer | null = null;
      if (drawable.tangents) { tangentBuffer = gl.createBuffer(); if (!tangentBuffer) throw new Error("Falha ao criar TANGENT buffer."); gl.bindBuffer(gl.ARRAY_BUFFER, tangentBuffer); gl.bufferData(gl.ARRAY_BUFFER, drawable.tangents, gl.STATIC_DRAW); }
      let texCoordBuffer: WebGLBuffer | null = null;
      if (drawable.texCoords) { texCoordBuffer = gl.createBuffer(); if (!texCoordBuffer) throw new Error("Falha ao criar TEXCOORD_0 buffer."); gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer); gl.bufferData(gl.ARRAY_BUFFER, drawable.texCoords, gl.STATIC_DRAW); }
      const [baseColorTexture, metallicRoughnessTexture, occlusionTexture, emissiveTexture, normalTexture] = await Promise.all([
        resolveTexture(drawable.baseColorTexture), resolveTexture(drawable.metallicRoughnessTexture), resolveTexture(drawable.occlusionTexture), resolveTexture(drawable.emissiveTexture), resolveTexture(drawable.normalTexture)
      ]);
      resources.push({ index, drawable, positionBuffer, normalBuffer, tangentBuffer, texCoordBuffer, baseColorTexture, metallicRoughnessTexture, occlusionTexture, emissiveTexture, normalTexture });
    }
    return { resources, gpuTextures };
  } catch (error) {
    for (const resource of resources) { gl.deleteBuffer(resource.positionBuffer); gl.deleteBuffer(resource.normalBuffer); if (resource.tangentBuffer) gl.deleteBuffer(resource.tangentBuffer); if (resource.texCoordBuffer) gl.deleteBuffer(resource.texCoordBuffer); }
    for (const texture of gpuTextures) gl.deleteTexture(texture);
    gl.deleteTexture(whiteTexture);
    throw error;
  }
}

async function renderNodeAnimatedPbr(
  canvas: HTMLCanvasElement,
  pbrModel: AlphaBlendPbrModel,
  animationModel: NodeAnimationRuntimeModel,
  normalization: AnimationNormalization,
  rotationDegrees: number
): Promise<() => void> {
  if (animationModel.primitives.length !== pbrModel.drawables.length) throw new Error("Primitive order divergiu entre PBR e animation runtime.");
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: false }) as WebGLRenderingContext | null;
  if (!gl) throw new Error("WebGL indisponível neste dispositivo.");
  if (Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)) < 5) throw new Error("GPU não oferece cinco texture units para node-animation-v10.");
  const program = createProgram(gl);
  const bindings = shaderBindings(gl, program);
  const whiteTexture = createWhiteTexture(gl);
  const { resources, gpuTextures } = await createGpuResources(gl, pbrModel.drawables, whiteTexture);
  const placement = rotationY(rotationDegrees * Math.PI / 180);
  const camera: Vec3 = [2.45, 1.65, 3.2];
  const view = lookAt(camera, [0, 0, 0], [0, 1, 0]);
  const lightDirection = new Float32Array(normalize([0.48, 0.82, 0.52]));
  const cameraPosition = new Float32Array(camera);
  const hasAnimation = animationModel.clips.length > 0 && animationModel.clips[0]!.durationSeconds > 0;
  let accumulatedVisibleMs = 0;
  let visibleStartMs: number | null = null;
  let frameId: number | null = null;
  let visible = true;
  let disposed = false;

  const elapsedSeconds = (timestamp: number): number => (accumulatedVisibleMs + (visibleStartMs === null ? 0 : Math.max(0, timestamp - visibleStartMs))) / 1000;
  const modelForResource = (resource: GpuDrawable, worlds: readonly Mat4[]): Mat4 => {
    const profile = animationModel.primitives[resource.index];
    if (!profile) throw new Error(`Primitive animation profile ${resource.index} ausente.`);
    const animatedWorld = worlds[profile.nodeIndex];
    if (!animatedWorld) throw new Error(`Animated world de node ${profile.nodeIndex} ausente.`);
    return multiply4(placement, animatedNormalizedDelta(profile.baseWorld, animatedWorld, normalization));
  };

  const drawResource = (resource: GpuDrawable, model: Mat4): void => {
    gl.uniformMatrix4fv(bindings.modelLocation, false, new Float32Array(model));
    gl.uniformMatrix3fv(bindings.normalMatrixLocation, false, normalMatrix3(model));
    gl.uniformMatrix3fv(bindings.directionMatrixLocation, false, topLeft3(model));
    gl.uniform1f(bindings.tangentHandednessLocation, determinant3(model) < 0 ? -1 : 1);
    bindMaterial(gl, bindings, resource, whiteTexture);
    gl.drawArrays(gl.TRIANGLES, 0, resource.drawable.positions.length / 3);
  };

  const draw = (timestamp: number): void => {
    if (disposed) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.useProgram(program);
    gl.uniformMatrix4fv(bindings.viewProjectionLocation, false, new Float32Array(multiply4(perspective(Math.PI / 4.2, width / height, 0.1, 20), view)));
    gl.uniform3fv(bindings.lightLocation, lightDirection); gl.uniform3fv(bindings.cameraLocation, cameraPosition);
    gl.uniform1i(bindings.baseTextureLocation, 0); gl.uniform1i(bindings.mrTextureLocation, 1); gl.uniform1i(bindings.occlusionTextureLocation, 2); gl.uniform1i(bindings.emissiveTextureLocation, 3); gl.uniform1i(bindings.normalTextureLocation, 4);
    const worlds = hasAnimation ? sampleCertifiedNodeWorldMatrices(animationModel, 0, elapsedSeconds(timestamp), true) : sampleCertifiedNodeWorldMatrices(animationModel, -1, 0, false);
    const solid: Readonly<{ resource: GpuDrawable; model: Mat4 }>[] = [];
    const transparent: { resource: GpuDrawable; model: Mat4; depth: number }[] = [];
    for (const resource of resources) {
      const model = modelForResource(resource, worlds);
      if (resource.drawable.alphaMode === "BLEND") {
        transparent.push({ resource, model, depth: distanceSquared(transformPoint(model, resource.drawable.centroid), camera) });
      } else solid.push({ resource, model });
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
    for (const entry of solid) drawResource(entry.resource, entry.model);
    transparent.sort((left, right) => right.depth - left.depth);
    if (transparent.length > 0) {
      gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      for (const entry of transparent) drawResource(entry.resource, entry.model);
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
  };

  const schedule = (): void => {
    if (!hasAnimation || !visible || disposed || frameId !== null) return;
    frameId = requestAnimationFrame((timestamp) => {
      frameId = null;
      draw(timestamp);
      schedule();
    });
  };
  const pause = (): void => {
    if (visibleStartMs !== null) { accumulatedVisibleMs += Math.max(0, performance.now() - visibleStartMs); visibleStartMs = null; }
    if (frameId !== null) { cancelAnimationFrame(frameId); frameId = null; }
  };
  const resume = (): void => {
    if (!hasAnimation || disposed) return;
    if (visibleStartMs === null) visibleStartMs = performance.now();
    schedule();
  };

  const resizeObserver = new ResizeObserver(() => draw(performance.now()));
  resizeObserver.observe(canvas);
  const intersectionObserver = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => {
        const nextVisible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0);
        if (nextVisible === visible) return;
        visible = nextVisible;
        if (visible) resume(); else pause();
      }, { threshold: 0.01 })
    : null;
  intersectionObserver?.observe(canvas);
  draw(performance.now());
  if (hasAnimation) { visibleStartMs = performance.now(); schedule(); }

  return () => {
    disposed = true;
    pause();
    resizeObserver.disconnect();
    intersectionObserver?.disconnect();
    for (const resource of resources) { gl.deleteBuffer(resource.positionBuffer); gl.deleteBuffer(resource.normalBuffer); if (resource.tangentBuffer) gl.deleteBuffer(resource.tangentBuffer); if (resource.texCoordBuffer) gl.deleteBuffer(resource.texCoordBuffer); }
    for (const texture of gpuTextures) gl.deleteTexture(texture);
    gl.deleteTexture(whiteTexture); gl.deleteProgram(program);
  };
}

function materialState(model: AlphaBlendPbrModel): string {
  if (model.alphaBlendedMaterials > 0) return "alpha-blend";
  if (model.alphaMaskedMaterials > 0) return "alpha-mask";
  if (model.normalMappedMaterials > 0) return "normal-mapped";
  if (model.emissiveTexturedMaterials > 0 && model.occlusionTexturedMaterials > 0) return "ambient-emissive-textured";
  if (model.emissiveTexturedMaterials > 0) return "emissive-textured";
  if (model.occlusionTexturedMaterials > 0) return "occlusion-textured";
  if (model.metallicRoughnessTexturedMaterials > 0) return "metallic-roughness-textured";
  if (model.baseColorTexturedMaterials > 0) return "base-color-textured";
  return "numeric-pbr";
}

export function GlbPlacement({ assetUrl, label, rotationYDegrees = 0, current = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [material, setMaterial] = useState("pending");
  const [animation, setAnimation] = useState("pending");

  useEffect(() => {
    const controller = new AbortController();
    let dispose: (() => void) | null = null;
    setState("loading"); setError(null); setMaterial("pending"); setAnimation("pending");
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
        const pbrModel = parseAlphaBlendPbrGlb(buffer);
        const animationModel = parseCertifiedNodeAnimationRuntime(buffer);
        const normalization = computeAnimationNormalization(buffer, animationModel);
        const cleanup = await renderNodeAnimatedPbr(canvas, pbrModel, animationModel, normalization, rotationYDegrees);
        if (controller.signal.aborted) { cleanup(); return; }
        dispose = cleanup;
        setMaterial(materialState(pbrModel));
        setAnimation(animationModel.clips.length > 0 ? "animated" : "static");
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Modelo 3D/animação incompatível.");
        setState("error");
      });
    return () => { controller.abort(); dispose?.(); };
  }, [assetUrl, rotationYDegrees]);

  return (
    <div
      aria-label={`Modelo 3D criado por usuário: ${label}`}
      className={styles.viewport}
      data-current={current ? "true" : "false"}
      data-glb-renderer="first-party-webgl-pbr-node-animation-v10"
      data-material-state={material}
      data-animation-state={animation}
      role="img"
      title={state === "error" ? `${label}: ${error ?? "modelo não suportado"}` : `${label} · PBR + node animation`}
    >
      <canvas aria-hidden="true" ref={canvasRef} />
      <span className={styles.badge} aria-hidden="true">GLB · PBR+ANIM</span>
      {state === "loading" ? <span className={styles.loading}>materializando animação 3D…</span> : null}
      {state === "error" ? <span className={styles.fallback}>3D seguro<br />animação indisponível</span> : null}
    </div>
  );
}

// Tehkné Solutions
