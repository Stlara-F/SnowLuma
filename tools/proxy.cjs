#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { WebSocket, WebSocketServer } = require('ws');

const CONFIG_DEFAULTS = {
  listen: '0.0.0.0:5701',
  tempDir: '/tmp/snowluma-proxy',
  maxVideoSize: 100 * 1024 * 1024,
  maxOutputSize: 95 * 1024 * 1024,
  probeSampleSeconds: 30,
  timeoutMs: 3600000,
  keepTempFiles: false,
  ffmpeg: {
    path: 'ffmpeg',
    ffprobePath: 'ffprobe',
    opusBitrate: '6k',
    opusCompression: 0,
    minResolution: '80x60',
    minFps: 1,
    maxEncodeMinutes: 10,
  },
  cache: {
    maxAgeDays: 7,
    maxDiskMb: 500,
  },
};

function loadConfig() {
  const cfgPath = path.join(__dirname, 'proxy-config.json');
  let fileCfg = {};
  try {
    if (fs.existsSync(cfgPath)) {
      fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
  } catch (e) {
    console.warn('[proxy] config file parse failed:', e.message);
  }

  const merged = deepMerge({}, CONFIG_DEFAULTS);
  deepMerge(merged, fileCfg);

  const [host, portStr] = merged.listen.split(':');
  merged.listenHost = host || '0.0.0.0';
  merged.listenPort = parseInt(portStr, 10) || 5701;

  const [mw, mh] = (merged.ffmpeg.minResolution || '80x60').split('x').map(Number);
  merged.ffmpeg._minW = mw || 80;
  merged.ffmpeg._minH = mh || 60;

  fs.mkdirSync(path.join(merged.tempDir, 'cache'), { recursive: true });
  fs.mkdirSync(path.join(merged.tempDir, 'chunks'), { recursive: true });
  fs.mkdirSync(path.join(merged.tempDir, 'work'), { recursive: true });

  return merged;
}

function deepMerge(target, src) {
  for (const k of Object.keys(src)) {
    if (src[k] !== null && typeof src[k] === 'object' && !Array.isArray(src[k])) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], src[k]);
    } else if (src[k] !== undefined) {
      target[k] = src[k];
    }
  }
  return target;
}

const CFG = loadConfig();
const log = (tag, msg, ...args) => {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}][proxy:${tag}] ${msg}`, ...args);
};

function readOneBotConfig(selfId) {
  const configDir = path.resolve('config');
  try {
    if (!fs.existsSync(configDir)) return null;

    if (selfId) {
      const uinPath = path.join(configDir, `onebot_${selfId}.json`);
      if (fs.existsSync(uinPath)) {
        const result = parseOneBotClients(JSON.parse(fs.readFileSync(uinPath, 'utf8')));
        if (result) { log('CONFIG', 'using per-UIN config for %s', selfId); return result; }
      }
    }

    const files = fs.readdirSync(configDir)
      .filter(f => /^onebot_[\d]+\.json$/.test(f))
      .sort();

    if (files.length === 0) {
      const globalPath = path.join(configDir, 'onebot.json');
      if (fs.existsSync(globalPath)) {
        const result = parseOneBotClients(JSON.parse(fs.readFileSync(globalPath, 'utf8')));
        if (result) log('CONFIG', 'using global config');
        return result;
      }
      return null;
    }

    log('CONFIG', 'no match for uin=%s, using %s', selfId, files[0]);
    return parseOneBotClients(JSON.parse(fs.readFileSync(path.join(configDir, files[0]), 'utf8')));
  } catch (err) {
    log('CONFIG', 'read onebot config failed: %s', err.message);
    return null;
  }
}

function parseOneBotClients(cfg) {
  const wsClients = cfg.networks?.wsClients || cfg.wsClients || [];
  if (!Array.isArray(wsClients) || wsClients.length === 0) return null;
  const entry = wsClients.find(c => c.upstream);
  if (!entry) {
    log('CONFIG', 'no wsClients entry with upstream field found');
    return null;
  }
  return { upstream: entry.upstream, accessToken: entry.accessToken || '' };
}

function uuid() {
  return crypto.randomUUID();
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getVideoSource(elem) {
  if (!elem || !elem.data) return null;
  return elem.data.file || elem.data.url || elem.data.path || elem.data.media || null;
}

function resolveSource(source) {
  if (!source || typeof source !== 'string') return null;
  if (/^base64:\/\//i.test(source)) return null;
  if (/^https?:\/\//i.test(source)) return null;
  if (/^file:\/\//i.test(source)) {
    let p = source.replace(/^file:\/\//, '');
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    return p;
  }
  return source;
}

function parseOneBotBody(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function isVideoAction(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const action = parsed.action || '';
  const valid = ['send_group_msg', 'send_private_msg'].includes(action);
  if (!valid) return false;
  const msg = parsed.params?.message;
  if (!Array.isArray(msg)) return false;
  return msg.some(e => e && e.type === 'video' && getVideoSource(e));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function runFfmpegCapture(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CFG.ffmpeg.ffprobePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      reject(new Error(`ffprobe timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`ffprobe exit=${code}: ${stderr.slice(-500)}`));
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`ffprobe spawn: ${err.message}`));
    });
  });
}

async function ffprobe(filePath) {
  const { stdout } = await runFfmpegCapture([
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    '-count_frames',
    '-read_intervals', `%+${CFG.probeSampleSeconds}`,
    filePath,
  ], 60000);

  return JSON.parse(stdout);
}

async function detectSceneChanges(filePath) {
  try {
    const { stderr } = await runFfmpegCapture([
      '-i', filePath,
      '-t', String(CFG.probeSampleSeconds),
      '-vf', "select='gt(scene,0.1)',metadata=print",
      '-f', 'null',
      '-',
    ], 60000);

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

const CLASS_ULTRA_REPETITIVE = 'ultra-repetitive';
const CLASS_STATIC_RECORDING = 'static-recording';
const CLASS_COMPRESSIBLE = 'compressible';
const CLASS_ALREADY_COMPRESSED = 'already-compressed';

function classifyContent(probeData, sceneData, fileSize, durationSec) {
  const vStream = (probeData.streams || []).find(s => s.codec_type === 'video');
  if (!vStream) return CLASS_ALREADY_COMPRESSED;

  const width = vStream.width || 0;
  const height = vStream.height || 0;
  const resolution = width * height;

  const fpsParts = (vStream.r_frame_rate || '30/1').split('/');
  const fps = parseInt(fpsParts[0], 10) / (parseInt(fpsParts[1], 10) || 1);

  const fmt = probeData.format || {};
  const totalBitrate = fmt.bit_rate
    ? parseInt(fmt.bit_rate, 10)
    : Math.round(fileSize * 8 / Math.max(durationSec, 1));

  const sampleFrames = parseInt(vStream.nb_read_frames || '0', 10);
  const expectedFrames = Math.round(fps * CFG.probeSampleSeconds);

  if (sceneData.sceneChanges >= 0 && sampleFrames > 0 && expectedFrames > 0) {
    const changeRatio = sceneData.sceneChanges / expectedFrames;
    if (changeRatio < 0.01) {
      log('CLASSIFY', 'ultra-repetitive (change_ratio=%.4f)', changeRatio);
      return CLASS_ULTRA_REPETITIVE;
    }
    if (changeRatio < 0.05) {
      log('CLASSIFY', 'static-recording (change_ratio=%.4f)', changeRatio);
      return CLASS_STATIC_RECORDING;
    }
  }

  if (totalBitrate > 0 && totalBitrate < 500000 && resolution <= 640 * 360) {
    log('CLASSIFY', 'already-compressed (bitrate=%d, res=%dx%d)', totalBitrate, width, height);
    return CLASS_ALREADY_COMPRESSED;
  }

  if (resolution > 0) {
    log('CLASSIFY', 'compressible (bitrate=%d, res=%dx%d)', totalBitrate, width, height);
    return CLASS_COMPRESSIBLE;
  }

  return CLASS_ALREADY_COMPRESSED;
}

function runFfmpeg(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CFG.ffmpeg.path, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let timedOut = false;

    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit=${code}: ${stderr.slice(-500)}`));
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg spawn: ${err.message}`));
    });
  });
}

function estimateEncodingTime(probeData) {
  const durationSec = parseFloat(probeData.format?.duration || '0');
  if (durationSec <= 0) return 0;
  const vStream = (probeData.streams || []).find(s => s.codec_type === 'video');
  const resolution = (vStream?.width || 0) * (vStream?.height || 0);
  const speedFactor = resolution > 1280 * 720 ? 0.5 : resolution > 640 * 360 ? 1 : 2;
  return (durationSec / 60) * speedFactor;
}

async function compressSeedLoop(inputPath, outputPath) {
  const workDir = path.join(CFG.tempDir, 'work', uuid());
  ensureDir(workDir);
  const seedPath = path.join(workDir, 'seed.mp4');
  const tinyPath = path.join(workDir, 'seed_tiny.mp4');

  try {
    await runFfmpeg([
      '-ss', '0', '-t', '2', '-i', inputPath,
      '-c', 'copy', '-y', seedPath,
    ], 30000);

    await runFfmpeg([
      '-i', seedPath,
      '-vf', `scale=${CFG.ffmpeg._minW}:${CFG.ffmpeg._minH},fps=${CFG.ffmpeg.minFps}`,
      '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '50',
      '-c:a', 'libopus', '-b:a', CFG.ffmpeg.opusBitrate,
      '-compression_level', String(CFG.ffmpeg.opusCompression),
      '-y', tinyPath,
    ], 120000);

    await runFfmpeg([
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
  await runFfmpeg([
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
      await runFfmpeg([
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
    await runFfmpeg([
      '-i', inputPath, '-vf', 'select=eq(n\\,0)', '-vframes', '1',
      '-y', posterPath,
    ], 30000);

    await runFfmpeg([
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

  await runFfmpeg([
    '-i', inputPath,
    '-c', 'copy', '-map', '0',
    '-f', 'segment', '-segment_time', '600',
    '-reset_timestamps', '1',
    '-y', pattern,
  ], 300000);

  const files = fs.readdirSync(outputDir)
    .filter(f => f.endsWith('.mp4'))
    .sort()
    .map(f => path.join(outputDir, f));

  return files;
}

async function compressVideo(inputPath, fileSize) {
  const probeData = await ffprobe(inputPath);
  const sceneData = await detectSceneChanges(inputPath);
  const durationSec = parseFloat(probeData.format?.duration || '0');
  const klass = classifyContent(probeData, sceneData, fileSize, durationSec);

  const estMin = estimateEncodingTime(probeData);
  log('COMPRESS', 'class=%s expected_encoding=~%d min content=%s', klass, Math.round(estMin), path.basename(inputPath));

  if (estMin > CFG.ffmpeg.maxEncodeMinutes && klass !== CLASS_ULTRA_REPETITIVE) {
    log('COMPRESS', 'encoding time ~%d min > max (%d min), falling back to split', Math.round(estMin), CFG.ffmpeg.maxEncodeMinutes);
    const splitDir = path.join(CFG.tempDir, 'chunks', uuid());
    const chunks = await compressSplit(inputPath, splitDir);
    return { type: 'split', files: chunks };
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
      const chunks = await compressSplit(inputPath, splitDir);
      return { type: 'split', files: chunks };
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
    const chunks = await compressSplit(inputPath, splitDir);
    return { type: 'split', files: chunks };
  }
}

async function lookupCache(filePath, fileSize) {
  const cacheKey = await hashFile(filePath) + '_' + fileSize;
  const cacheDir = path.join(CFG.tempDir, 'cache');
  const metaPath = path.join(cacheDir, cacheKey + '.json');
  const dataPath = path.join(cacheDir, cacheKey + '.mp4');

  try {
    if (fs.existsSync(metaPath) && fs.existsSync(dataPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (Date.now() - meta.createdAt < CFG.cache.maxAgeDays * 86400000) {
        log('CACHE', 'hit: %s (%s)', cacheKey, meta.strategy);
        return { type: 'single', file: dataPath };
      }
    }
  } catch {}
  return null;
}

function cleanCache() {
  const cacheDir = path.join(CFG.tempDir, 'cache');
  try {
    const entries = fs.readdirSync(cacheDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const p = path.join(cacheDir, f);
        try {
          const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
          return { metaPath: p, dataPath: p.replace('.json', '.mp4'), ...meta };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => a.createdAt - b.createdAt);

    let totalMb = 0;
    for (const e of entries) {
      try { totalMb += fs.statSync(e.dataPath).size / 1048576; } catch {}
    }

    while (totalMb > CFG.cache.maxDiskMb && entries.length > 0) {
      const oldest = entries.shift();
      try {
        const sz = fs.statSync(oldest.dataPath).size / 1048576;
        fs.unlinkSync(oldest.dataPath);
        fs.unlinkSync(oldest.metaPath);
        totalMb -= sz;
        log('CACHE', 'evicted %s (%.0f MB)', path.basename(oldest.dataPath), sz);
      } catch {}
    }
  } catch {}
}

setInterval(cleanCache, 3600000);
cleanCache();

function safeSend(ws, data) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  } catch (err) {
    log('WS', 'send failed: %s', err.message);
  }
}

async function processVideoInMessage(parsed) {
  const params = parsed.params || {};
  const msg = params.message || [];
  let modified = false;

  const newMsg = [];
  const pendingSplits = [];

  for (const elem of msg) {
    if (!elem || elem.type !== 'video') {
      newMsg.push(elem);
      continue;
    }

    const filePath = resolveSource(getVideoSource(elem));
    if (!filePath) {
      newMsg.push(elem);
      continue;
    }

    try {
      if (!fs.existsSync(filePath)) {
        log('VIDEO', 'file not found: %s', filePath);
        newMsg.push(elem);
        continue;
      }

      const stat = fs.statSync(filePath);
      if (stat.size <= CFG.maxVideoSize) {
        newMsg.push(elem);
        continue;
      }

      log('VIDEO', 'processing: %s (%d MB)', path.basename(filePath), Math.round(stat.size / 1048576));

      const cached = await lookupCache(filePath, stat.size);
      if (cached && cached.type === 'single' && fs.existsSync(cached.file)) {
        const cachedStat = fs.statSync(cached.file);
        if (cachedStat.size <= CFG.maxOutputSize) {
          newMsg.push({ type: 'video', data: { ...elem.data, file: cached.file } });
          modified = true;
          continue;
        }
      }

      const result = await compressVideo(filePath, stat.size);

      if (result.type === 'single') {
        newMsg.push({ type: 'video', data: { ...elem.data, file: result.file } });
        modified = true;
      } else if (result.type === 'split') {
        pendingSplits.push({ files: result.files, originalData: elem.data, splitDir: path.dirname(result.files[0]) });
      }
    } catch (err) {
      log('VIDEO', 'error processing %s: %s', getVideoSource(elem), err.message);
      newMsg.push(elem);
    }
  }

  if (!modified && pendingSplits.length === 0) return null;
  return { newMsg, pendingSplits, params, action: parsed.action, echo: parsed.echo };
}

async function sendSplitChunks(action, params, splits, echo, sendFn) {
  for (const split of splits) {
    for (const file of split.files) {
      const splitParams = { ...params, message: [{ type: 'video', data: { ...split.originalData, file } }] };
      sendFn(JSON.stringify({ action, params: splitParams, echo }));
      await sleep(200);
    }
  }
}

function establishLink(downstream, req) {
  const selfId = req.headers['x-self-id'] || '';
  const role = req.headers['x-client-role'] || 'Universal';
  const clientToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');

  log('WS', 'SnowLuma connected (uin=%s, role=%s)', selfId, role);

  const obCfg = readOneBotConfig(selfId);
  if (!obCfg) {
    log('FATAL', 'no onebot config with upstream field found');
    downstream.close(1011, 'proxy: upstream not configured - add upstream to wsClients in WebUI');
    return;
  }

  const upstreamUrl = obCfg.upstream;
  const upstreamToken = obCfg.accessToken || clientToken;

  log('WS', 'connecting to upstream %s', upstreamUrl);

  let upstream = null;
  let closed = false;
  const msgQueue = [];
  let processing = false;
  const pendingDownstream = [];
  const MAX_PENDING = 256;

  const processQueue = async () => {
    if (processing) return;
    processing = true;

    while (msgQueue.length > 0) {
      const { raw, sendFn } = msgQueue.shift();
      try {
        const handled = await processVideoInMessage(parseOneBotBody(raw));
        if (handled) {
          if (handled.pendingSplits.length > 0) {
            sendSplitChunks(handled.action, handled.params, handled.pendingSplits, handled.echo, sendFn)
              .then(() => {
                for (const sp of handled.pendingSplits) {
                  try { fs.rmSync(sp.splitDir, { recursive: true, force: true }); } catch (e) { log('CLEANUP', 'rm failed: %s', e.message); }
                }
              })
              .catch(err => {
                log('SPLIT', 'error: %s', err.message);
                for (const sp of handled.pendingSplits) {
                  try { fs.rmSync(sp.splitDir, { recursive: true, force: true }); } catch (e) { log('CLEANUP', 'rm failed: %s', e.message); }
                }
              });
          }
          if (handled.newMsg.length > 0) {
            sendFn(JSON.stringify({
              action: handled.action,
              params: { ...handled.params, message: handled.newMsg },
              echo: handled.echo,
            }));
            log('WS', 'forwarded compressed message (%d elements)', handled.newMsg.length);
          }
        } else {
          sendFn(raw);
        }
      } catch (err) {
        log('WS', 'queue process error: %s', err.message);
        sendFn(raw);
      }
    }

    processing = false;
  };

  const cleanup = () => {
    closed = true;
    if (upstream) { try { upstream.close(); } catch {} }
  };

  const connectUpstream = () => {
    if (closed) return;

    const headers = {
      'User-Agent': 'OneBot/11',
      'X-Self-ID': selfId,
      'X-Client-Role': role,
    };
    if (upstreamToken) headers['Authorization'] = `Bearer ${upstreamToken}`;

    upstream = new WebSocket(upstreamUrl, { headers });

    upstream.on('open', () => {
      log('WS', 'upstream connected');
      for (const msg of pendingDownstream) { safeSend(upstream, msg); }
      pendingDownstream.length = 0;
    });

    upstream.on('message', (data, isBinary) => {
      const raw = isBinary && Buffer.isBuffer(data) ? data.toString() : data;
      const sendFn = (body) => safeSend(downstream, body);
      msgQueue.push({ raw, sendFn });
      processQueue();
    });

    upstream.on('close', () => {
      log('WS', 'upstream disconnected, reconnecting in 5s');
      upstream = null;
      if (!closed) setTimeout(connectUpstream, 5000);
    });

    upstream.on('error', (err) => {
      log('WS', 'upstream error: %s', err.message);
    });
  };

  downstream.on('message', (data, isBinary) => {
    const raw = isBinary && Buffer.isBuffer(data) ? data : data;
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      safeSend(upstream, raw);
    } else if (pendingDownstream.length < MAX_PENDING) {
      pendingDownstream.push(raw);
    }
  });

  downstream.on('close', () => {
    log('WS', 'downstream disconnected');
    cleanup();
  });

  downstream.on('error', () => cleanup());

  connectUpstream();
}

function startServer() {
  const wss = new WebSocketServer({ host: CFG.listenHost, port: CFG.listenPort });

  wss.on('connection', (downstream, req) => {
    establishLink(downstream, req);
  });

  wss.on('error', (err) => {
    log('FATAL', 'WS server error: %s', err.message);
  });

  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   SnowLuma Video Oversize Proxy (WS)    ║');
  console.log('  ║──────────────────────────────────────────║');
  console.log(`  ║   Listen : ${CFG.listenHost}:${CFG.listenPort}                ║`);
  console.log(`  ║   Temp   : ${CFG.tempDir}     ║`);
  console.log(`  ║   Limit  : ${Math.round(CFG.maxVideoSize / 1048576)} MB → ≤${Math.round(CFG.maxOutputSize / 1048576)} MB            ║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
}

startServer();

process.on('uncaughtException', (err) => {
  log('FATAL', 'uncaught: %s', err.message);
});

process.on('unhandledRejection', (err) => {
  log('FATAL', 'unhandled rejection: %s', err instanceof Error ? err.message : String(err));
});
