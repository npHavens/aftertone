export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export function validateImage(file: Pick<File, 'type' | 'size' | 'name'>): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return `${file.name}: choose a JPG, PNG, or WebP image.`;
  if (file.size === 0) return `${file.name}: this file is empty.`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name}: images must be 10 MB or smaller.`;
  return null;
}
