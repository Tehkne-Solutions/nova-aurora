import type { ObjectAnimationState } from "./glb-object-animation-state";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_VERSION = 2;

const CLIP_NAMES: Readonly<Record<ObjectAnimationState, string>> = Object.freeze({
  idle: "Idle",
  open: "Open",
  close: "Close",
  activate: "Activate",
  deactivate: "Deactivate",
  spin: "Spin"
});

type GlbChunk = Readonly<{ type: number; bytes: Uint8Array }>;
type JsonObject = Record<string, unknown>;

export type PreparedAnimationStateAsset = Readonly<{
  buffer: ArrayBuffer;
  requestedState: ObjectAnimationState;
  requestedClipName: string;
  selectedClipName: string | null;
  selectedClipIndex: number;
  reordered: boolean;
}>;

function parseChunks(buffer: ArrayBuffer): readonly GlbChunk[] {
  if (buffer.byteLength < 20) throw new Error("GLB incompleto para seleção de estado.");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== GLB_VERSION) {
    throw new Error("GLB 2.0 inválido para seleção de estado.");
  }
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error("Comprimento GLB inconsistente.");
  const chunks: GlbChunk[] = [];
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (length < 0 || offset + length > buffer.byteLength) throw new Error("Chunk GLB truncado.");
    const bytes = new Uint8Array(length);
    bytes.set(new Uint8Array(buffer, offset, length));
    chunks.push({ type, bytes });
    offset += length;
  }
  if (offset !== buffer.byteLength) throw new Error("GLB possui bytes residuais fora de chunks.");
  if (chunks.length === 0 || chunks[0]!.type !== GLB_JSON_CHUNK) throw new Error("GLB precisa iniciar pelo chunk JSON.");
  return chunks;
}

function parseDocument(bytes: Uint8Array): JsonObject {
  const text = new TextDecoder().decode(bytes).replace(/[\u0000\u0020]+$/g, "");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Documento glTF precisa ser objeto.");
  const document = value as JsonObject;
  const asset = document.asset;
  if (!asset || typeof asset !== "object" || Array.isArray(asset) || (asset as JsonObject).version !== "2.0") {
    throw new Error("Documento glTF 2.0 ausente.");
  }
  return document;
}

function animationName(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return typeof (value as JsonObject).name === "string" ? String((value as JsonObject).name).trim() : "";
}

function jsonChunk(document: JsonObject): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(document));
  const paddedLength = Math.ceil(encoded.byteLength / 4) * 4;
  const output = new Uint8Array(paddedLength);
  output.fill(0x20);
  output.set(encoded);
  return output;
}

function rebuild(chunks: readonly GlbChunk[]): ArrayBuffer {
  const total = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.bytes.byteLength, 0);
  const output = new ArrayBuffer(total);
  const view = new DataView(output);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, total, true);
  let offset = 12;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.bytes.byteLength, true);
    view.setUint32(offset + 4, chunk.type, true);
    new Uint8Array(output, offset + 8, chunk.bytes.byteLength).set(chunk.bytes);
    offset += 8 + chunk.bytes.byteLength;
  }
  return output;
}

export function prepareGlbForAnimationState(
  source: ArrayBuffer,
  state: ObjectAnimationState
): PreparedAnimationStateAsset {
  const chunks = parseChunks(source);
  const document = parseDocument(chunks[0]!.bytes);
  const animations = Array.isArray(document.animations) ? [...document.animations] : [];
  const requestedClipName = CLIP_NAMES[state];
  const selectedClipIndex = animations.findIndex(
    (animation) => animationName(animation).toLocaleLowerCase() === requestedClipName.toLocaleLowerCase()
  );
  const selectedClipName = selectedClipIndex >= 0 ? animationName(animations[selectedClipIndex]) : null;
  const reordered = selectedClipIndex > 0;

  if (!reordered) {
    const clone = source.slice(0);
    return { buffer: clone, requestedState: state, requestedClipName, selectedClipName, selectedClipIndex, reordered: false };
  }

  const selected = animations[selectedClipIndex]!;
  animations.splice(selectedClipIndex, 1);
  animations.unshift(selected);
  const updatedDocument: JsonObject = { ...document, animations };
  const updatedChunks: GlbChunk[] = [{ type: GLB_JSON_CHUNK, bytes: jsonChunk(updatedDocument) }, ...chunks.slice(1)];
  return {
    buffer: rebuild(updatedChunks),
    requestedState: state,
    requestedClipName,
    selectedClipName,
    selectedClipIndex,
    reordered: true
  };
}

// Tehkné Solutions
