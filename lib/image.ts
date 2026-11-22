// Photos are shrunk before upload, so this only bounds the file the browser has to decode.
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export function validateImage(file: Pick<File, 'type' | 'size' | 'name'>): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return `${file.name}: choose a JPG, PNG, or WebP image.`;
  if (file.size === 0) return `${file.name}: this file is empty.`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name}: images must be 50 MB or smaller.`;
  return null;
}

// Shrinks a photo to the JPEG the backend's normalize_image sends to Gemini: upright and within
// 2048 × 2048 pixels. A 15 MB phone photo then uploads in a megabyte or two. Rejects with the
// signal's reason as soon as the photo is cancelled.
export async function shrinkImage(file: File, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  let bitmap: ImageBitmap | undefined;

  // A decode can't be cancelled. Racing it against the signal lets a removed photo give up its
  // place in the queue at once, and a decode that finishes after that frees its own bitmap.
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const decoding = createImageBitmap(file, { imageOrientation: 'from-image' }).then((decoded) => {
    if (signal.aborted) decoded.close();
    return decoded;
  });

  try {
    bitmap = await Promise.race([decoding, aborted]);
  } catch (error) {
    signal.throwIfAborted();
    throw new Error('This file is not a supported, readable image.', { cause: error });
  }

  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    // A long, thin image keeps at least one pixel per side, as Pillow's thumbnail does.
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The browser has no 2D canvas context.');

    // JPEG has no transparency, so transparent pixels go on white rather than black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    // The default 'low' smoothing aliases a large downscale and blurs small text on covers.
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  } catch (error) {
    signal.throwIfAborted();
    // The photo decoded, so the browser failed to draw or encode it; the cause keeps its own error.
    throw new Error("This photo couldn't be prepared for upload. Please try again.", {
      cause: error,
    });
  } finally {
    bitmap.close();
  }
}
