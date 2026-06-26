import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';

const testDir = join(tmpdir(), `sl-ffmpeg-test-${randomUUID()}`);
const tempDir = join(testDir, 'segments');

const KNOWN_FFMPEG_DIR = 'C:\\Users\\Administrator\\Desktop\\snowluma-dev\\SnowLuma-dev\\node_modules\\.pnpm\\@ffmpeg-installer+ffmpeg@1.1.0\\node_modules\\@ffmpeg-installer\\win32-x64';
const KNOWN_FFPROBE_DIR = 'C:\\Users\\Administrator\\Desktop\\snowluma-dev\\SnowLuma-dev\\node_modules\\.pnpm\\@ffprobe-installer+ffprobe@2.1.2\\node_modules\\@ffprobe-installer\\win32-x64';

function generateTestVideo(outPath: string, durationSec: number): void {
  const r = spawnSync(join(KNOWN_FFMPEG_DIR, 'ffmpeg.exe'), [
    '-f', 'lavfi',
    '-i', `testsrc=duration=${durationSec}:size=320x240:rate=15`,
    '-f', 'lavfi',
    '-i', 'anullsrc=r=44100:cl=mono',
    '-shortest',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '28',
    '-c:a', 'aac',
    '-y',
    outPath,
  ], { stdio: 'pipe', encoding: 'utf-8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`ffmpeg gen failed: ${r.stderr?.slice(-200)}`);
  if (statSync(outPath).size === 0) throw new Error('generated video is empty');
}

function ensurePath(): void {
  const dirs = [KNOWN_FFMPEG_DIR, KNOWN_FFPROBE_DIR];
  const pathParts = (process.env.PATH || '').split(';').filter(Boolean);
  for (const dir of dirs) {
    if (!pathParts.some(p => p.toLowerCase() === dir.toLowerCase())) {
      pathParts.unshift(dir);
    }
  }
  process.env.PATH = pathParts.join(';');
}

describe('ffmpeg-cli', () => {
  beforeAll(() => {
    mkdirSync(tempDir, { recursive: true });
    ensurePath();
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    (await import('../../src/highway/ffmpeg-cli'))._resetFfmpegCache();
  });

  describe('calculateSegments', () => {
    it('single segment when size <= 95MB', async () => {
      const { calculateSegments } = await import('../../src/highway/ffmpeg-cli');
      expect(calculateSegments(50 * 1024 * 1024, 120)).toHaveLength(1);
    });

    it('two segments just over 95MB boundary', async () => {
      const { calculateSegments } = await import('../../src/highway/ffmpeg-cli');
      expect(calculateSegments(96 * 1024 * 1024, 120)).toHaveLength(2);
    });

    it('multiple segments for large video', async () => {
      const { calculateSegments } = await import('../../src/highway/ffmpeg-cli');
      const segs = calculateSegments(300 * 1024 * 1024, 200);
      expect(segs.length).toBeGreaterThan(1);
      expect(segs[0].start).toBe(0);
      for (const s of segs) {
        expect(s.duration).toBeGreaterThan(0);
      }
    });

    it('first segment starts at 0', async () => {
      const { calculateSegments } = await import('../../src/highway/ffmpeg-cli');
      expect(calculateSegments(200 * 1024 * 1024, 100)[0].start).toBe(0);
    });

    it('subsequent segments have overlap', async () => {
      const { calculateSegments } = await import('../../src/highway/ffmpeg-cli');
      const segs = calculateSegments(400 * 1024 * 1024, 300);
      expect(segs.length).toBeGreaterThanOrEqual(4);
      expect(segs[1].start - (300 / segs.length)).toBeCloseTo(-1.0, 1);
    });
  });

  describe('isFfmpegAvailable', () => {
    it('returns true when ffmpeg is in PATH', async () => {
      const { isFfmpegAvailable } = await import('../../src/highway/ffmpeg-cli');
      expect(isFfmpegAvailable()).toBe(true);
    });
  });

  describe('probeDuration', () => {
    it('returns duration for a real video', async () => {
      const testVideo = join(testDir, 'probe-test.mp4');
      generateTestVideo(testVideo, 5);
      const { probeDuration } = await import('../../src/highway/ffmpeg-cli');
      const dur = await probeDuration(testVideo);
      expect(dur).toBeGreaterThanOrEqual(4);
      expect(dur).toBeLessThanOrEqual(6);
    });
  });

  describe('splitSegment', () => {
    it('extracts a segment from video', async () => {
      const { splitSegment } = await import('../../src/highway/ffmpeg-cli');
      const testVideo = join(testDir, 'split-test.mp4');
      generateTestVideo(testVideo, 10);
      const outPath = join(tempDir, 'seg0.mp4');
      const size = await splitSegment(testVideo, outPath, 0, 5);
      expect(size).toBeGreaterThan(0);
      expect(existsSync(outPath)).toBe(true);
    });
  });

  describe('splitVideo', () => {
    it('splits into multiple segments with valid paths', async () => {
      const { splitVideo } = await import('../../src/highway/ffmpeg-cli');
      const testVideo = join(testDir, 'full-split.mp4');
      generateTestVideo(testVideo, 10);
      const fakeSize = Math.max(statSync(testVideo).size, 96 * 1024 * 1024);
      const segments = await splitVideo(testVideo, tempDir, fakeSize, 10);
      expect(segments.length).toBeGreaterThan(1);
      for (const seg of segments) {
        expect(existsSync(seg.path)).toBe(true);
        expect(seg.size).toBeGreaterThan(0);
        expect(seg.path).not.toContain('//');
      }
    });

    it('single segment for small video', async () => {
      const { splitVideo } = await import('../../src/highway/ffmpeg-cli');
      const testVideo = join(testDir, 'small-test.mp4');
      generateTestVideo(testVideo, 3);
      const segments = await splitVideo(testVideo, tempDir, statSync(testVideo).size, 3);
      expect(segments).toHaveLength(1);
      expect(existsSync(segments[0].path)).toBe(true);
    });

    it('segment names are just filenames not full paths', async () => {
      const { splitVideo } = await import('../../src/highway/ffmpeg-cli');
      const testVideo = join(testDir, 'name-test.mp4');
      generateTestVideo(testVideo, 3);
      const segments = await splitVideo(testVideo, tempDir, 96 * 1024 * 1024, 3);
      for (const seg of segments) {
        expect(seg.name).not.toContain('\\');
        expect(seg.name).not.toContain('/');
        expect(seg.name).not.toContain(':');
      }
    });
  });

  describe('cleanupTempDir', () => {
    it('removes temp directory', async () => {
      const { cleanupTempDir } = await import('../../src/highway/ffmpeg-cli');
      const d = join(testDir, 'clean-me');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'x.txt'), 'test');
      cleanupTempDir(d);
      expect(existsSync(d)).toBe(false);
    });

    it('does not throw on missing directory', async () => {
      const { cleanupTempDir } = await import('../../src/highway/ffmpeg-cli');
      expect(() => cleanupTempDir(join(testDir, 'ghost'))).not.toThrow();
    });
  });
});
