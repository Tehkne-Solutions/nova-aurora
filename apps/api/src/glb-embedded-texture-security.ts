import { GlbSecurityError } from "./glb-structural-security.js";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

export const GLB_TEXTURE_SECURITY_LIMITS = Object.freeze({
  maxImages: 32,
  maxTextures: 64,
  maxImageEncodedBytes: 4 * 1024 * 1024,
  maxTotalImageEncodedBytes: 16 * 1024 * 1024,
  maxDimension: 4096,
  maxImagePixels: 16_777_216,
  maxTotalDecodedPixels: 33_554_432
});

export type GlbTextureSecurityImage = Readonly<{
  index: number;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bufferView: number;
  encodedBytes: number;
  width: number;
  height: number;
  pixels: number;
}>;

export type GlbTextureSecurityReport = Readonly<{
  images: number;
  textures: number;
  samplers: number;
  referencedImages: number;
  totalEncodedBytes: number;
  totalDecodedPixels: number;
  maxWidth: number;
  maxHeight: number;
  formats: readonly string[];
  imageDetails: readonly GlbTextureSecurityImage[];
  externalResources: 0;
  signature: "Tehkné Solutions";
}>;

type JsonRecord = Record<string, unknown>;

type ParsedGlb = Readonly<{
  document: JsonRecord;
  binary: Buffer;
}>;

function fail(code: string, message: string): never {
  throw new GlbSecurityError(`texture-${code}`, message);
}

function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-json-shape", `${label} precisa ser um objeto.`);
  }
  return value as JsonRecord;
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

function index(value: unknown, length: number, label: string): number {
  const parsed = integer(value, label);
  if (parsed >= length) fail("reference-out-of-range", `${label} aponta para índice inexistente ${parsed}.`);
  return parsed;
}

function parseGlb(bytes: Buffer): ParsedGlb {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== GLB_MAGIC || bytes.readUInt32LE(4) !== 2) {
    fail("container", "Container GLB 2.0 inválido para validação de texturas.");
  }
  let offset = 12;
  let document: JsonRecord | null = null;
  let binary: Buffer | null = null;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + length > bytes.length) fail("container", "Chunk GLB truncado durante validação de texturas.");
    const chunk = bytes.subarray(offset, offset + length);
    if (type === GLB_JSON_CHUNK && !document) {
      const text = chunk.toString("utf8").replace(/[\u0000\u0020]+$/g, "");
      try {
        document = object(JSON.parse(text), "Documento glTF");
      } catch (error) {
        if (error instanceof GlbSecurityError) throw error;
        fail("json", "Chunk JSON GLB inválido durante validação de texturas.");
      }
    } else if (type === GLB_BIN_CHUNK && !binary) {
      binary = chunk;
    }
    offset += length;
  }
  if (!document) fail("json", "Chunk JSON GLB ausente.");
  return { document, binary: binary ?? Buffer.alloc(0) };
}

function bufferViewBytes(view: JsonRecord, binary: Buffer, label: string): Buffer {
  if (integer(view.buffer, `${label}.buffer`) !== 0) fail("buffer", `${label} precisa apontar para buffer BIN 0.`);
  const byteOffset = view.byteOffset === undefined ? 0 : integer(view.byteOffset, `${label}.byteOffset`);
  const byteLength = integer(view.byteLength, `${label}.byteLength`, 1);
  if (byteOffset + byteLength > binary.length) fail("buffer-range", `${label} ultrapassa o chunk BIN.`);
  return binary.subarray(byteOffset, byteOffset + byteLength);
}

function pngDimensions(bytes: Buffer): readonly [number, number] {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) fail("image-signature", "PNG embutido possui assinatura inválida.");
  if (bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    fail("image-header", "PNG embutido não possui IHDR canônico como primeiro chunk.");
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function jpegDimensions(bytes: Buffer): readonly [number, number] {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("image-signature", "JPEG embutido possui assinatura inválida.");
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) fail("image-header", "Segmento JPEG embutido inválido.");
    const isSof = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (length < 7) fail("image-header", "SOF JPEG embutido incompleto.");
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return [width, height];
    }
    offset += length;
  }
  return fail("image-dimensions", "JPEG embutido não possui marcador SOF com dimensões.");
}

function readUint24LE(bytes: Buffer, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function webpDimensions(bytes: Buffer): readonly [number, number] {
  if (
    bytes.length < 16
    || bytes.subarray(0, 4).toString("ascii") !== "RIFF"
    || bytes.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    fail("image-signature", "WebP embutido possui assinatura inválida.");
  }
  const chunk = bytes.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    if (bytes.length < 30) fail("image-header", "VP8X embutido incompleto.");
    return [1 + readUint24LE(bytes, 24), 1 + readUint24LE(bytes, 27)];
  }
  if (chunk === "VP8 ") {
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      fail("image-header", "VP8 embutido não possui frame header válido.");
    }
    return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  }
  if (chunk === "VP8L") {
    if (bytes.length < 25 || bytes[20] !== 0x2f) fail("image-header", "VP8L embutido não possui signature byte válido.");
    const bits = bytes.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  return fail("image-header", `WebP embutido usa chunk não suportado: ${chunk || "ausente"}.`);
}

function dimensions(bytes: Buffer, mimeType: string): readonly [number, number] {
  if (mimeType === "image/png") return pngDimensions(bytes);
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  if (mimeType === "image/webp") return webpDimensions(bytes);
  return fail("mime", `MIME de imagem embutida não suportado: ${mimeType}.`);
}

function validateDimensions(width: number, height: number, label: string): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    fail("image-dimensions", `${label} possui dimensões inválidas ${width}x${height}.`);
  }
  if (width > GLB_TEXTURE_SECURITY_LIMITS.maxDimension || height > GLB_TEXTURE_SECURITY_LIMITS.maxDimension) {
    fail("dimension-limit", `${label} excede ${GLB_TEXTURE_SECURITY_LIMITS.maxDimension}x${GLB_TEXTURE_SECURITY_LIMITS.maxDimension}.`);
  }
  const pixels = width * height;
  if (pixels > GLB_TEXTURE_SECURITY_LIMITS.maxImagePixels) {
    fail("pixel-limit", `${label} excede ${GLB_TEXTURE_SECURITY_LIMITS.maxImagePixels} pixels.`);
  }
  return pixels;
}

function validateTextureReference(info: JsonRecord, textures: JsonRecord[], label: string): void {
  if (info.index === undefined) return;
  index(info.index, textures.length, `${label}.index`);
  if (info.texCoord !== undefined && integer(info.texCoord, `${label}.texCoord`) !== 0) {
    fail("texcoord", `${label}.texCoord precisa ser 0 no perfil inicial de texturas.`);
  }
  if (info.extensions !== undefined) fail("texture-extension", `${label}.extensions ainda não pertence ao perfil seguro.`);
}

export function validateGlbEmbeddedTextures(bytes: Buffer): GlbTextureSecurityReport {
  const { document, binary } = parseGlb(bytes);
  const bufferViews = array(document.bufferViews, "bufferViews").map((value, indexValue) => object(value, `bufferViews[${indexValue}]`));
  const images = array(document.images, "images").map((value, indexValue) => object(value, `images[${indexValue}]`));
  const textures = array(document.textures, "textures").map((value, indexValue) => object(value, `textures[${indexValue}]`));
  const samplers = array(document.samplers, "samplers").map((value, indexValue) => object(value, `samplers[${indexValue}]`));
  const materials = array(document.materials, "materials").map((value, indexValue) => object(value, `materials[${indexValue}]`));

  if (images.length > GLB_TEXTURE_SECURITY_LIMITS.maxImages) fail("image-count", `GLB excede ${GLB_TEXTURE_SECURITY_LIMITS.maxImages} imagens embutidas.`);
  if (textures.length > GLB_TEXTURE_SECURITY_LIMITS.maxTextures) fail("texture-count", `GLB excede ${GLB_TEXTURE_SECURITY_LIMITS.maxTextures} textures.`);

  let totalEncodedBytes = 0;
  let totalDecodedPixels = 0;
  let maxWidth = 0;
  let maxHeight = 0;
  const formatSet = new Set<string>();
  const imageDetails: GlbTextureSecurityImage[] = [];

  for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
    const image = images[imageIndex]!;
    if (image.uri !== undefined) fail("external-resource", `images[${imageIndex}] usa URI; somente bufferView incorporado é permitido.`);
    const viewIndex = index(image.bufferView, bufferViews.length, `images[${imageIndex}].bufferView`);
    const mimeType = String(image.mimeType ?? "");
    if (!(["image/png", "image/jpeg", "image/webp"] as const).includes(mimeType as "image/png" | "image/jpeg" | "image/webp")) {
      fail("mime", `images[${imageIndex}].mimeType não suportado: ${mimeType || "ausente"}.`);
    }
    const imageBytes = bufferViewBytes(bufferViews[viewIndex]!, binary, `bufferViews[${viewIndex}]`);
    if (imageBytes.length > GLB_TEXTURE_SECURITY_LIMITS.maxImageEncodedBytes) {
      fail("encoded-size", `images[${imageIndex}] excede ${GLB_TEXTURE_SECURITY_LIMITS.maxImageEncodedBytes} bytes codificados.`);
    }
    totalEncodedBytes += imageBytes.length;
    if (totalEncodedBytes > GLB_TEXTURE_SECURITY_LIMITS.maxTotalImageEncodedBytes) {
      fail("total-encoded-size", `Texturas embutidas excedem ${GLB_TEXTURE_SECURITY_LIMITS.maxTotalImageEncodedBytes} bytes codificados.`);
    }
    const [width, height] = dimensions(imageBytes, mimeType);
    const pixels = validateDimensions(width, height, `images[${imageIndex}]`);
    totalDecodedPixels += pixels;
    if (totalDecodedPixels > GLB_TEXTURE_SECURITY_LIMITS.maxTotalDecodedPixels) {
      fail("total-pixel-limit", `Texturas embutidas excedem ${GLB_TEXTURE_SECURITY_LIMITS.maxTotalDecodedPixels} pixels decodificados.`);
    }
    maxWidth = Math.max(maxWidth, width);
    maxHeight = Math.max(maxHeight, height);
    formatSet.add(mimeType);
    imageDetails.push({
      index: imageIndex,
      mimeType: mimeType as GlbTextureSecurityImage["mimeType"],
      bufferView: viewIndex,
      encodedBytes: imageBytes.length,
      width,
      height,
      pixels
    });
  }

  const referencedImages = new Set<number>();
  for (let textureIndex = 0; textureIndex < textures.length; textureIndex += 1) {
    const texture = textures[textureIndex]!;
    if (texture.extensions !== undefined) fail("texture-extension", `textures[${textureIndex}].extensions ainda não pertence ao perfil seguro.`);
    const source = index(texture.source, images.length, `textures[${textureIndex}].source`);
    referencedImages.add(source);
    if (texture.sampler !== undefined) {
      const samplerIndex = index(texture.sampler, samplers.length, `textures[${textureIndex}].sampler`);
      const sampler = samplers[samplerIndex]!;
      if (sampler.extensions !== undefined) fail("sampler-extension", `samplers[${samplerIndex}].extensions ainda não pertence ao perfil seguro.`);
      const magFilter = sampler.magFilter === undefined ? 9729 : integer(sampler.magFilter, `samplers[${samplerIndex}].magFilter`);
      const minFilter = sampler.minFilter === undefined ? 9987 : integer(sampler.minFilter, `samplers[${samplerIndex}].minFilter`);
      const wrapS = sampler.wrapS === undefined ? 10497 : integer(sampler.wrapS, `samplers[${samplerIndex}].wrapS`);
      const wrapT = sampler.wrapT === undefined ? 10497 : integer(sampler.wrapT, `samplers[${samplerIndex}].wrapT`);
      if (![9728, 9729].includes(magFilter)) fail("sampler-filter", `samplers[${samplerIndex}].magFilter inválido.`);
      if (![9728, 9729, 9984, 9985, 9986, 9987].includes(minFilter)) fail("sampler-filter", `samplers[${samplerIndex}].minFilter inválido.`);
      if (![33071, 33648, 10497].includes(wrapS) || ![33071, 33648, 10497].includes(wrapT)) {
        fail("sampler-wrap", `samplers[${samplerIndex}] usa wrap mode inválido.`);
      }
    }
  }

  for (let materialIndex = 0; materialIndex < materials.length; materialIndex += 1) {
    const material = materials[materialIndex]!;
    const pbr = material.pbrMetallicRoughness === undefined
      ? null
      : object(material.pbrMetallicRoughness, `materials[${materialIndex}].pbrMetallicRoughness`);
    if (pbr?.baseColorTexture !== undefined) validateTextureReference(object(pbr.baseColorTexture, `materials[${materialIndex}].pbrMetallicRoughness.baseColorTexture`), textures, `materials[${materialIndex}].pbrMetallicRoughness.baseColorTexture`);
    if (pbr?.metallicRoughnessTexture !== undefined) validateTextureReference(object(pbr.metallicRoughnessTexture, `materials[${materialIndex}].pbrMetallicRoughness.metallicRoughnessTexture`), textures, `materials[${materialIndex}].pbrMetallicRoughness.metallicRoughnessTexture`);
    if (material.normalTexture !== undefined) validateTextureReference(object(material.normalTexture, `materials[${materialIndex}].normalTexture`), textures, `materials[${materialIndex}].normalTexture`);
    if (material.occlusionTexture !== undefined) validateTextureReference(object(material.occlusionTexture, `materials[${materialIndex}].occlusionTexture`), textures, `materials[${materialIndex}].occlusionTexture`);
    if (material.emissiveTexture !== undefined) validateTextureReference(object(material.emissiveTexture, `materials[${materialIndex}].emissiveTexture`), textures, `materials[${materialIndex}].emissiveTexture`);
  }

  return {
    images: images.length,
    textures: textures.length,
    samplers: samplers.length,
    referencedImages: referencedImages.size,
    totalEncodedBytes,
    totalDecodedPixels,
    maxWidth,
    maxHeight,
    formats: [...formatSet].sort(),
    imageDetails,
    externalResources: 0,
    signature: "Tehkné Solutions"
  };
}

// Tehkné Solutions
