import { ImageManipulator } from 'expo-image-manipulator';

import { MAX_EDGE, prepareProofPhoto } from '@/lib/photo';

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

function fakeContext(saved = 'file:///resized.jpg') {
  const saveAsync = jest.fn().mockResolvedValue({ uri: saved });
  const context = {
    resize: jest.fn(),
    renderAsync: jest.fn().mockResolvedValue({ saveAsync }),
  };
  (ImageManipulator.manipulate as jest.Mock).mockReturnValue(context);
  return { context, saveAsync };
}

describe('prepareProofPhoto', () => {
  it('shrinks a landscape photo by its width', async () => {
    const { context } = fakeContext();
    const uri = await prepareProofPhoto('file:///big.jpg', 4000, 3000);
    expect(context.resize).toHaveBeenCalledWith({ width: MAX_EDGE });
    expect(uri).toBe('file:///resized.jpg');
  });

  it('shrinks a portrait photo by its height, so the long edge is what is capped', async () => {
    const { context } = fakeContext();
    await prepareProofPhoto('file:///big.jpg', 3000, 4000);
    expect(context.resize).toHaveBeenCalledWith({ height: MAX_EDGE });
  });

  it('never enlarges a small photo, but still re-encodes it', async () => {
    const { context, saveAsync } = fakeContext();
    await prepareProofPhoto('file:///small.jpg', 1200, 900);
    expect(context.resize).not.toHaveBeenCalled();
    expect(saveAsync).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpeg' }));
  });

  /**
   * A resize bug must never cost a driver their delivery: a slow upload is a
   * worse afternoon, a refused delivery is a lost record.
   */
  it('falls back to the original rather than failing the delivery', async () => {
    (ImageManipulator.manipulate as jest.Mock).mockImplementation(() => {
      throw new Error('native module missing');
    });
    expect(await prepareProofPhoto('file:///orig.jpg', 4000, 3000)).toBe('file:///orig.jpg');
  });
});
