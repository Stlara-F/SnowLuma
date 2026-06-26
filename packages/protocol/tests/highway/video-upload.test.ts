import { describe, it, expect } from 'vitest';

describe('getVideoSourceSize', () => {
  it('returns fileSize when element has positive fileSize', async () => {
    const { getVideoSourceSize } = await import('../../src/highway/video-upload');
    expect(getVideoSourceSize({ type: 'video', fileSize: 42 * 1024 * 1024 } as any)).toBe(42 * 1024 * 1024);
  });

  it('returns null when element has fileSize 0 and no url', async () => {
    const { getVideoSourceSize } = await import('../../src/highway/video-upload');
    expect(getVideoSourceSize({ type: 'video', fileSize: 0 } as any)).toBeNull();
  });

  it('returns null when element has no fileSize, url, or fileId', async () => {
    const { getVideoSourceSize } = await import('../../src/highway/video-upload');
    expect(getVideoSourceSize({ type: 'video' } as any)).toBeNull();
  });

  it('returns null when element has url but no local file', async () => {
    const { getVideoSourceSize } = await import('../../src/highway/video-upload');
    expect(getVideoSourceSize({ type: 'video', url: 'http://example.com/video.mp4' } as any)).toBeNull();
  });

  it('returns null when element has fileId but no local file', async () => {
    const { getVideoSourceSize } = await import('../../src/highway/video-upload');
    expect(getVideoSourceSize({ type: 'video', fileId: 'some-file-id' } as any)).toBeNull();
  });
});
