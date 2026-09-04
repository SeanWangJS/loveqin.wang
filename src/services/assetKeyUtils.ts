import path from 'path';

export type PhotoVariant = 'original' | 'display' | 'thumb_high' | 'thumb_low';

export const LOCAL_OBJECT_STORE_DIR = path.resolve(process.cwd(), '.local-object-store');

/**
 * 构造全局统一的 R2 对象存储 Key
 * 规范完全对齐 TECHNICAL_DESIGN.md 与 MediaService：
 * - original: originals/{householdId}/{photoId}{ext}
 * - display: display/{householdId}/{photoId}.webp
 * - thumb_high: thumbs_high/{householdId}/{photoId}.webp
 * - thumb_low: thumbs_low/{householdId}/{photoId}.webp
 */
export function buildPhotoAssetKey(
  householdId: string,
  photoId: string,
  variant: PhotoVariant,
  ext?: string
): string {
  if (variant === 'original') {
    const cleanExt = ext ? (ext.startsWith('.') ? ext : `.${ext}`) : '.jpg';
    return `originals/${householdId}/${photoId}${cleanExt}`;
  }
  const folder = variant === 'thumb_high' ? 'thumbs_high' : variant === 'thumb_low' ? 'thumbs_low' : 'display';
  return `${folder}/${householdId}/${photoId}.webp`;
}

/**
 * 获取本地私有模拟对象文件的绝对路径
 */
export function getLocalObjectPath(r2Key: string): string {
  return path.resolve(LOCAL_OBJECT_STORE_DIR, r2Key);
}
