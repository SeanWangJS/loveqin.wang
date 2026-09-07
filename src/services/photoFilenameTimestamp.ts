const MIN_PHOTO_TIMESTAMP_MS = Date.UTC(2000, 0, 1);
const MAX_FUTURE_OFFSET_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * 从常见照片文件名中解析 13 位 Unix 毫秒时间戳，例如 mmexport1495709624210.jpg。
 * 仅接受 2000 年至当前时间后一年内的时间，避免误识别普通数字。
 */
export function parseFilenameTimestamp(filename: string, nowMs = Date.now()): number | null {
  const match = filename.match(/(?:^|[^0-9])([12][0-9]{12})(?![0-9])/);
  if (!match) return null;

  const timestampMs = Number(match[1]);
  if (!Number.isSafeInteger(timestampMs)) return null;
  if (timestampMs < MIN_PHOTO_TIMESTAMP_MS || timestampMs > nowMs + MAX_FUTURE_OFFSET_MS) {
    return null;
  }

  return timestampMs;
}
