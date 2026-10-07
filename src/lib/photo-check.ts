/**
 * Catches a photo with nothing in it — a covered lens, a black frame — before
 * it is uploaded as a driver document. Load 24 accepted five solid-black
 * images as a licence, a mulkiya and a truck photo (OPEN_ISSUES.md).
 *
 * No image decoder ships in the app, and adding one is a native change. A JPEG
 * of a flat field compresses to almost nothing, though: each 8×8 block keeps
 * only its average. A real photograph of a card or a truck at the picker's
 * quality 0.6 is well above 0.03 bytes per pixel; a black frame is under
 * 0.005. The threshold sits between, so a dim but real photo still passes —
 * blur and glare remain a person's call at review.
 *
 * Only JPEG is judged. A PNG screenshot of a document is legitimately small,
 * and PNG's compression says nothing about whether the picture is empty.
 */
export const BLANK_JPEG_BYTES_PER_PIXEL = 0.008;

export function looksBlank(photo: {
  mime: string | undefined;
  bytes: number;
  width: number;
  height: number;
}): boolean {
  if (photo.mime !== 'image/jpeg') return false;
  const pixels = photo.width * photo.height;
  if (!Number.isFinite(pixels) || pixels <= 0) return false;
  return photo.bytes / pixels < BLANK_JPEG_BYTES_PER_PIXEL;
}
