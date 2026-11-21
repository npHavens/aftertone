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
// 2048 × 2048 pixels. A 15 MB phone photo then uploads in a megabyte or two.
export async function shrinkImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap | undefined;

  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This file is not a supported, readable image.');
  }

  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, width, height);

      return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    } else {
      throw new Error('The browser has no 2D canvas context.');
    }
  } catch (error) {
    // The photo decoded, so the browser failed to draw or encode it; the cause keeps its own error.
    throw new Error("This photo couldn't be prepared for upload. Please try again.", {
      cause: error,
    });
  } finally {
    bitmap.close();
  }
}
