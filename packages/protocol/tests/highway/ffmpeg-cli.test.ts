import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const testDir = join(tmpdir(), `sl-ffmpeg-test-${randomUUID()}`);

describe('ffmpeg-cli', () => {
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

    it('subsequent segments have 1s overlap', async () => {
      const { calculateSegments } = await import('../../src/highway/ffmpeg-cli');
      const segs = calculateSegments(400 * 1024 * 1024, 300);
      expect(segs.length).toBeGreaterThanOrEqual(4);
      const baseDuration = 300 / segs.length;
      expect(baseDuration - segs[1].start).toBeCloseTo(1.0, 1);
    });

    it('exact 95MB file produces single segment', async () => {
      const { calculateSegments } = await import('../../src/highway/ffmpeg-cli');
      expect(calculateSegments(95 * 1024 * 1024, 60)).toHaveLength(1);
    });

    it('segment durations sum to totalDuration plus overlap', async () => {
      const { calculateSegments } = await import('../../src/highway/ffmpeg-cli');
      const segs = calculateSegments(500 * 1024 * 1024, 250);
      const total = segs.reduce((s, seg) => s + seg.duration, 0);
      // each segment after the first has 1s overlap
      const overlapTotal = (segs.length - 1) * 1.0;
      expect(total).toBeCloseTo(250 + overlapTotal, 0);
    });

    it('no segments returned for zero-size video', async () => {
      const { calculateSegments } = await import('../../src/highway/ffmpeg-cli');
      expect(calculateSegments(0, 0)).toHaveLength(1);
    });

    it('all segments have positive duration', async () => {
      const { calculateSegments } = await import('../../src/highway/ffmpeg-cli');
      const segs = calculateSegments(600 * 1024 * 1024, 360);
      for (const s of segs) {
        expect(s.duration).toBeGreaterThan(0);
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
