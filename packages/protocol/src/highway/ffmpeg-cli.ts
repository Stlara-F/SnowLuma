import { spawn, spawnSync } from 'child_process';
import { existsSync, rmSync, statSync } from 'fs';
import path from 'path';
import { createLogger } from '@snowluma/common/logger';
import { getVideoDuration } from './video-upload';

const log = createLogger('Highway.FFmpegCLI');

let _ffmpegChecked = false;
let _ffmpegAvailable = false;

const MAX_SEGMENTS = 5;
const OVERLAP_SECONDS = 1.0;

export function _resetFfmpegCache(): void {
  _ffmpegChecked = false;
  _ffmpegAvailable = false;
}

export function isFfmpegAvailable(): boolean {
  if (_ffmpegChecked) return _ffmpegAvailable;
  _ffmpegChecked = true;

  const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'pipe', timeout: 10_000 });
  _ffmpegAvailable = ffmpeg.status === 0;

  if (!_ffmpegAvailable) {
    log.warn('ffmpeg not found in PATH; large video splitting unavailable, will fall back to file upload');
  }
  return _ffmpegAvailable;
}

export interface SegmentPlan {
  index: number;
  start: number;
  duration: number;
}

export interface SplitSegment {
  index: number;
  path: string;
  name: string;
  size: number;
}

const MAX_BYTES_PER_SEGMENT = 95 * 1024 * 1024;

export function calculateSegments(totalSize: number, totalDuration: number): SegmentPlan[] {
  const numSegments = Math.ceil(totalSize / MAX_BYTES_PER_SEGMENT);

  if (numSegments > MAX_SEGMENTS) {
    log.warn('video needs %d segments, exceeding recommendation of %d; will still attempt', numSegments, MAX_SEGMENTS);
  }

  if (numSegments <= 1) {
    return [{ index: 0, start: 0, duration: totalDuration }];
  }

  const baseDuration = totalDuration / numSegments;
  const segments: SegmentPlan[] = [];

  for (let i = 0; i < numSegments; i++) {
    const start = Math.max(0, i * baseDuration - (i > 0 ? OVERLAP_SECONDS : 0));
    const end = Math.min(totalDuration, (i + 1) * baseDuration);
    segments.push({ index: i, start, duration: end - start });
  }

  return segments;
}

export async function probeDuration(filePath: string): Promise<number> {
  const ffprobe = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    filePath,
  ], { encoding: 'utf-8', timeout: 30_000 });

  if (ffprobe.status === 0 && ffprobe.stdout) {
    const dur = parseFloat(ffprobe.stdout.trim());
    if (Number.isFinite(dur) && dur > 0) return dur;
  }

  const viaAddon = await getVideoDuration(filePath);
  return viaAddon;
}

export function splitSegment(inputPath: string, outputPath: string, start: number, duration: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      '-ss', String(start),
      '-i', inputPath,
      '-t', String(duration),
      '-c', 'copy',
      '-avoid_negative_ts', '1',
      '-y',
      outputPath,
    ];

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 600_000);
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], signal: ac.signal });
    let stderr = '';

    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        try {
          const realSize = statSync(outputPath).size;
          if (realSize === 0) return reject(new Error('ffmpeg output file is empty'));
          resolve(realSize);
        } catch (err) {
          reject(new Error(`ffmpeg output check failed: ${err instanceof Error ? err.message : String(err)}`));
        }
      } else {
        reject(new Error(`ffmpeg exit code ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err: Error) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)));
  });
}

export async function splitVideo(
  inputPath: string,
  tempDir: string,
  totalSize: number,
  totalDuration: number,
): Promise<SplitSegment[]> {
  const segments = calculateSegments(totalSize, totalDuration);
  const ext = path.extname(inputPath) || '.mp4';
  const baseName = path.basename(inputPath, ext);
  const ts = Date.now();

  const result: SplitSegment[] = [];

  for (const seg of segments) {
    const segName = `${baseName}_${ts}_part${seg.index + 1}${ext}`;
    const outputPath = path.join(tempDir, segName);

    const realSize = await splitSegment(inputPath, outputPath, seg.start, seg.duration);
    if (realSize > MAX_BYTES_PER_SEGMENT) {
      log.warn('segment %d actual size %d exceeds %d — ffmpeg may not have split properly', seg.index, realSize, MAX_BYTES_PER_SEGMENT);
    }
    result.push({ index: seg.index, path: outputPath, name: segName, size: realSize });
  }

  return result;
}

export function cleanupTempDir(tempDir: string): void {
  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // best-effort cleanup
  }
}
