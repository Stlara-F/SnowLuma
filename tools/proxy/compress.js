import fs from 'fs';
import path from 'path';
import { CFG, log } from './config.js';
import { runFfmpeg, ffprobe, detectSceneChanges, estimateEncodingTime } from './ffmpeg.js';
import { CLASS_ULTRA_REPETITIVE, CLASS_STATIC_RECORDING, CLASS_COMPRESSIBLE, CLASS_ALREADY_COMPRESSED, classifyContent } from './classify.js';
import { uuid, hashFile, lookupCache, ensureDir } from './cache.js';

async function compressSeedLoop(inputPath, outputPath) {
  const workDir = path.join(CFG.tempDir, 'work', uuid());
  ensureDir(workDir);
  const seedPath = path.join(workDir, 'seed.mp4');
  const tinyPath = path.join(workDir, 'seed_tiny.mp4');

  try {
    await runFfmpeg(CFG.ffmpeg.path, [
      '-ss', '0', '-t', '2', '-i', inputPath,
      '-c', 'copy', '-y', seedPath,
    ], 30000);

    await runFfmpeg(CFG.ffmpeg.path, [
      '-i', seedPath,
      '-vf', `scale=${CFG.ffmpeg._minW}:${CFG.ffmpeg._minH},fps=${CFG.ffmpeg.minFps}`,
      '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '50',
      '-c:a', 'libopus', '-b:a', CFG.ffmpeg.opusBitrate,
      '-compression_level', String(CFG.ffmpeg.opusCompression),
      '-y', tinyPath,
    ], 120000);

    await runFfmpeg(CFG.ffmpeg.path, [
      '-stream_loop', '999999', '-i', tinyPath,
      '-c', 'copy',
      '-fs', String(CFG.maxOutputSize),
      '-y', outputPath,
    ], CFG.timeoutMs);
  } finally {
    if (!CFG.keepTempFiles) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

async function compressMpdecimate(inputPath, outputPath) {
  await runFfmpeg(CFG.ffmpeg.path, [
    '-i', inputPath,
    '-vf', 'mpdecimate=max=0.1:hi=32:lo=16:frac=0.1',
    '-vsync', 'vfr',
    '-af', 'silenceremove=start_periods=1:start_duration=2:start_threshold=-50dB:detection=peak',
    '-c:v', 'libx265', '-preset', 'veryfast', '-crf', '30',
    '-c:a', 'libopus', '-b:a', '12k', '-compression_level', '0',
    '-fs', String(CFG.maxOutputSize),
    '-movflags', '+faststart',
    '-y', outputPath,
  ], CFG.timeoutMs);
}

const CRF_GRADIENTS = [
  { label: 'gradient-1', scale: '640:360', fps: 15, crf: 28, audio: '24k' },
  { label: 'gradient-2', scale: '320:240', fps: 10, crf: 35, audio: '12k' },
  { label: 'gradient-3', scale: '160:120', fps: 5,  crf: 45, audio: '6k' },
  { label: 'gradient-4', scale: '80:60',   fps: 2,  crf: 50, audio: '6k' },
];

async function compressCrfProgressive(inputPath, outputPath) {
  for (const g of CRF_GRADIENTS) {
    const attemptPath = outputPath + '.tmp';
    try {
      log('CRF', 'trying %s (%s, %dfps, crf=%d)', g.label, g.scale, g.fps, g.crf);
      await runFfmpeg(CFG.ffmpeg.path, [
        '-i', inputPath,
        '-vf', `scale=${g.scale},fps=${g.fps}`,
        '-c:v', 'libx265', '-preset', 'veryfast', '-crf', String(g.crf),
        '-c:a', 'libopus', '-b:a', g.audio, '-compression_level', '0',
        '-fs', String(CFG.maxOutputSize),
        '-movflags', '+faststart',
        '-y', attemptPath,
      ], CFG.timeoutMs);

      const stat = fs.statSync(attemptPath);
      if (stat.size <= CFG.maxOutputSize) {
        fs.renameSync(attemptPath, outputPath);
        log('CRF', '%s succeeded: %d MB', g.label, Math.round(stat.size / 1048576));
        return;
      }
      log('CRF', '%s output %d MB > %d MB, trying next gradient',
        g.label, Math.round(stat.size / 1048576), Math.round(CFG.maxOutputSize / 1048576));
      fs.unlinkSync(attemptPath);
    } catch (err) {
      log('CRF', '%s failed (%s), trying next gradient', g.label, err.message);
      try { fs.unlinkSync(attemptPath); } catch {}
    }
  }
  throw new Error('all crf gradients failed');
}

async function compressPosterOpus(inputPath, outputPath) {
  const workDir = path.join(CFG.tempDir, 'work', uuid());
  ensureDir(workDir);
  const posterPath = path.join(workDir, 'poster.jpg');

  try {
    await runFfmpeg(CFG.ffmpeg.path, [
      '-i', inputPath, '-vf', 'select=eq(n\\,0)', '-vframes', '1',
      '-y', posterPath,
    ], 30000);

    await runFfmpeg(CFG.ffmpeg.path, [
      '-i', inputPath, '-i', posterPath,
      '-c:v', 'libx264', '-crf', '40', '-vf', 'scale=320:240',
      '-c:a', 'libopus', '-b:a', CFG.ffmpeg.opusBitrate,
      '-shortest', '-map', '1:v', '-map', '0:a?',
      '-fs', String(CFG.maxOutputSize),
      '-movflags', '+faststart',
      '-y', outputPath,
    ], CFG.timeoutMs);
  } finally {
    if (!CFG.keepTempFiles) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

async function compressSplit(inputPath, outputDir) {
  ensureDir(outputDir);
  const pattern = path.join(outputDir, 'chunk_%03d.mp4');

  await runFfmpeg(CFG.ffmpeg.path, [
    '-i', inputPath,
    '-c', 'copy', '-map', '0',
    '-f', 'segment', '-segment_time', '600',
    '-reset_timestamps', '1',
    '-y', pattern,
  ], 300000);

  return fs.readdirSync(outputDir)
    .filter(f => f.endsWith('.mp4'))
    .sort()
    .map(f => path.join(outputDir, f));
}

export async function compressVideo(inputPath, fileSize) {
  const probeData = await ffprobe(inputPath);
  const sceneData = await detectSceneChanges(inputPath);
  const durationSec = parseFloat(probeData.format?.duration || '0');
  const klass = classifyContent(probeData, sceneData, fileSize, durationSec);

  const estMin = estimateEncodingTime(probeData);
  log('COMPRESS', 'class=%s expected_encoding=~%d min content=%s', klass, Math.round(estMin), path.basename(inputPath));

  if (estMin > CFG.ffmpeg.maxEncodeMinutes && klass !== CLASS_ULTRA_REPETITIVE) {
    log('COMPRESS', 'encoding time ~%d min > max (%d min), falling back to split', Math.round(estMin), CFG.ffmpeg.maxEncodeMinutes);
    const splitDir = path.join(CFG.tempDir, 'chunks', uuid());
    return { type: 'split', files: await compressSplit(inputPath, splitDir) };
  }

  const outputPath = path.join(CFG.tempDir, 'work', `${uuid()}.mp4`);

  try {
    switch (klass) {
      case CLASS_ULTRA_REPETITIVE:
        await compressSeedLoop(inputPath, outputPath);
        break;
      case CLASS_STATIC_RECORDING:
        await compressMpdecimate(inputPath, outputPath);
        break;
      case CLASS_COMPRESSIBLE:
        await compressCrfProgressive(inputPath, outputPath);
        break;
      case CLASS_ALREADY_COMPRESSED:
        await compressPosterOpus(inputPath, outputPath);
        break;
    }

    const outStat = fs.statSync(outputPath);
    if (outStat.size > CFG.maxOutputSize) {
      log('COMPRESS', 'output %d MB still > %d MB, falling back to split', Math.round(outStat.size / 1048576), Math.round(CFG.maxOutputSize / 1048576));
      fs.unlinkSync(outputPath);
      const splitDir = path.join(CFG.tempDir, 'chunks', uuid());
      return { type: 'split', files: await compressSplit(inputPath, splitDir) };
    }

    const cacheKey = await hashFile(inputPath) + '_' + fileSize;
    const cacheDir = path.join(CFG.tempDir, 'cache');
    const cacheMetaPath = path.join(cacheDir, cacheKey + '.json');
    const cacheFilePath = path.join(cacheDir, cacheKey + '.mp4');

    try {
      fs.copyFileSync(outputPath, cacheFilePath);
      fs.writeFileSync(cacheMetaPath, JSON.stringify({
        sourceSize: fileSize,
        outputSize: outStat.size,
        strategy: klass,
        createdAt: Date.now(),
        originalPath: inputPath,
      }), 'utf8');
    } catch {}

    if (!CFG.keepTempFiles) {
      try { fs.unlinkSync(outputPath); } catch {}
    }

    log('COMPRESS', 'success: %d MB -> %d MB (%.1f%%)',
      Math.round(fileSize / 1048576), Math.round(outStat.size / 1048576),
      (outStat.size / fileSize) * 100);

    return { type: 'single', file: cacheFilePath };
  } catch (err) {
    log('COMPRESS', 'strategy %s failed: %s, falling back to split', klass, err.message);
    try { fs.unlinkSync(outputPath); } catch {}
    const splitDir = path.join(CFG.tempDir, 'chunks', uuid());
    return { type: 'split', files: await compressSplit(inputPath, splitDir) };
  }
}
