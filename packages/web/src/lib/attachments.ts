export type AttachmentRange = { start: number; end: number };

export type PendingAttachment = {
  id: string;
  name: string;
  path: string;
  size?: number;
  mimeType?: string;
  image?: { data: string; mimeType: string };
  range?: AttachmentRange;
  /**
   * Reference-mode attachment: instead of inlining the file's bytes into the
   * prompt, send only the workspace path so omp reads it directly. The daemon
   * emits `File attachment: <path>` when this is true, regardless of size.
   * Ignored for image attachments (images always carry pixel data).
   */
  asReference?: boolean;
};

export type UploadedFile = { path: string; name: string; size: number };

const id = () => globalThis.crypto?.randomUUID?.() ?? `attachment_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export const attachmentId = id;

export function rangeLabel(range?: AttachmentRange): string {
  return range ? `lines ${range.start}–${range.end}` : '';
}

export function hasKnownNoImageInput(model?: { capabilities?: unknown; input?: unknown }): boolean {
  if (!model) return false;
  const metadata = model.capabilities ?? model.input;
  if (metadata === undefined || metadata === null) return false;
  if (Array.isArray(metadata)) {
    return metadata.length > 0 && !metadata.some((value) => /image|vision|multimodal/i.test(String(value)));
  }
  if (typeof metadata === 'string') return !/image|vision|multimodal/i.test(metadata);
  if (typeof metadata !== 'object') return false;
  const value = metadata as Record<string, unknown>;
  for (const key of ['image', 'images', 'vision', 'imageInput', 'image_input']) {
    if (key in value && value[key] === false) return true;
    if (key in value && value[key] === true) return false;
  }
  const flattened = Object.entries(value)
    .filter(([, candidate]) => typeof candidate === 'boolean' || typeof candidate === 'string')
    .map(([key, candidate]) => `${key}:${String(candidate)}`);
  return flattened.length > 0 && !flattened.some((candidate) => /image|vision|multimodal/i.test(candidate) && !/false$/i.test(candidate));
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function dataUrlParts(dataUrl: string): { data: string; mimeType: string } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('The selected image could not be encoded.');
  return { mimeType: match[1], data: match[2] };
}

/** Browser-side resize prevents needless vision payloads while retaining readable detail. */
export async function imageForPrompt(file: File, maxDimension = 1568): Promise<{ data: string; mimeType: string; size: number }> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`);
  const original = dataUrlParts(await readAsDataUrl(file));
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return { ...original, size: file.size };
  }
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error(`Could not decode ${file.name}`));
    image.onload = () => resolve(image);
    image.src = `data:${original.mimeType};base64,${original.data}`;
  });
  const ratio = Math.min(1, maxDimension / Math.max(source.naturalWidth, source.naturalHeight));
  if (ratio === 1) return { ...original, size: file.size };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(source.naturalHeight * ratio));
  const context = canvas.getContext('2d');
  if (!context) return { ...original, size: file.size };
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const resized = dataUrlParts(canvas.toDataURL(original.mimeType === 'image/png' ? 'image/png' : 'image/jpeg', 0.9));
  return { ...resized, size: Math.round(resized.data.length * 0.75) };
}

export async function fileForUpload(file: File): Promise<{ data: string; mimeType?: string; size: number }> {
  const parts = dataUrlParts(await readAsDataUrl(file));
  return { data: parts.data, mimeType: file.type || undefined, size: file.size };
}
