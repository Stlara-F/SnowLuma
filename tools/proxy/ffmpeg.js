import { spawn } from 'child_process';
import path from 'path';
import { CFG, log } from './config.js';

export function runFfmpeg(binary, args, timeoutMs, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      reject(new Error(`${path.basename(binary)} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) resolve(opts.capture ? { stdout, stderr } : undefined);
      else reject(new Error(`${path.basename(binary)} exit=${code}: ${stderr.slice(-500)}`));
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`${path.basename(binary)} spawn: ${err.message}`));
    });
  });
}

export async function ffprobe(filePath) {
  const { stdout } = await runFfmpeg(CFG.ffmpeg.ffprobePath, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    '-count_frames',
    '-read_intervals', `%+${CFG.probeSampleSeconds}`,
    filePath,
  ], 60000, { capture: true });

  return JSON.parse(stdout);
}

export async function detectSceneChanges(filePath) {
  try {
    const { stderr } = await runFfmpeg(CFG.ffmpeg.path, [
      '-i', filePath,
      '-t', String(CFG.probeSampleSeconds),
      '-vf', "select='gt(scene,0.1)',metadata=print",
      '-f', 'null',
      '-',
    ], 60000, { capture: true });

    const matches = stderr.match(/Parsed_metadata.*?pts_time:\s*([\d.]+)/g) || [];
    const ptsTimes = matches.map(m => {
      const v = m.match(/pts_time:\s*([\d.]+)/);
      return v ? parseFloat(v[1]) : -1;
    }).filter(t => t >= 0);

    return { sceneChanges: ptsTimes.length, sceneTimes: ptsTimes };
  } catch (err) {
    log('PROBE', 'scene detect warning: %s', err.message);
    return { sceneChanges: -1 };
  }
}

export function estimateEncodingTime(probeData) {
  const durationSec = parseFloat(probeData.format?.duration || '0');
  if (durationSec <= 0) return 0;
  const vStream = (probeData.streams || []).find(s => s.codec_type === 'video');
  const resolution = (vStream?.width || 0) * (vStream?.height || 0);
  const speedFactor = resolution > 1280 * 720 ? 0.5 : resolution > 640 * 360 ? 1 : 2;
  return (durationSec / 60) * speedFactor;
}
