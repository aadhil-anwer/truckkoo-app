/**
 * Proof-of-delivery photos, sized for a dock with one bar of signal.
 *
 * A phone camera at `quality: 0.6` still writes a multi-megabyte file; uploaded
 * at the moment a driver is standing at the gate on bad signal, it is the
 * slowest thing in the app. 1600px on the long edge still reads a plate or a
 * signature, at roughly a tenth of the bytes. Re-encoding also drops the
 * original's metadata.
 *
 * NEVER BLOCKS A DELIVERY. If resizing fails for any reason, the original is
 * returned: a slow upload is a worse afternoon, a refused delivery is a lost
 * record.
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export const MAX_EDGE = 1600;
const QUALITY = 0.7;

export async function prepareProofPhoto(
  uri: string,
  width: number,
  height: number,
): Promise<string> {
  try {
    const context = ImageManipulator.manipulate(uri);
    if (Math.max(width, height) > MAX_EDGE) {
      context.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
    }
    const image = await context.renderAsync();
    const result = await image.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG });
    return result.uri;
  } catch {
    return uri;
  }
}
