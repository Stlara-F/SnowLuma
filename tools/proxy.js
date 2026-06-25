#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const urlMod = require('url');

const CONFIG_DEFAULTS = {
  listen: '0.0.0.0:5701',
  target: 'http://127.0.0.1:3000',
  accessToken: '',
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

  const envCfg = {};
  if (process.env.PROXY_LISTEN) envCfg.listen = process.env.PROXY_LISTEN;
  if (process.env.PROXY_TARGET) envCfg.target = process.env.PROXY_TARGET;
  if (process.env.PROXY_TEMP_DIR) envCfg.tempDir = process.env.PROXY_TEMP_DIR;
  if (process.env.PROXY_ACCESS_TOKEN) envCfg.accessToken = process.env.PROXY_ACCESS_TOKEN;

  const merged = deepMerge(CONFIG_DEFAULTS, fileCfg);
  deepMerge(merged, envCfg);

  const [host, portStr] = merged.listen.split(':');
  merged.listenHost = host || '0.0.0.0';
  merged.listenPort = parseInt(portStr, 10) || 5701;

  const parsed = urlMod.parse(merged.target);
  merged.targetHost = parsed.hostname || '127.0.0.1';
  merged.targetPort = parseInt(parsed.port, 10) || 3000;
  merged.targetPath = parsed.path || '/';

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

function uuid() {
  return crypto.randomUUID();
}

function md5File(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(65536);
  const bytesRead = fs.readSync(fd, buf, 0, 65536, 0);
  fs.closeSync(fd);
  return crypto.createHash('md5').update(buf.subarray(0, bytesRead)).digest('hex');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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
  try {
    return JSON.parse(raw);
  } catch { return null; }
}

function isVideoAction(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const action = parsed.action || '';
  const valid = ['send_group_msg', 'send_private_msg'].includes(action);
  if (!valid) return false;
  const msg = parsed.params?.message;
  if (!Array.isArray(msg)) return false;
  return msg.some(e => e && e.type === 'video' && e.data && e.data.file);
}

async function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > maxBytes) { req.destroy(); reject(new Error('body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function passthrough(clientReq, clientRes, body) {
  const options = {
    hostname: CFG.targetHost,
    port: CFG.targetPort,
    path: clientReq.url || CFG.targetPath,
    method: clientReq.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  if (CFG.accessToken) {
    options.headers['Authorization'] = `Bearer ${CFG.accessToken}`;
  }

  const proxyReq = http.request(options, (proxyRes) => {
    clientRes.statusCode = proxyRes.statusCode || 200;
    const headers = { ...proxyRes.headers };
    delete headers['content-encoding'];
    delete headers['transfer-encoding'];
    clientRes.writeHead(proxyRes.statusCode || 200, headers);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', (err) => {
    log('ERROR', 'passthrough failed: %s', err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({ status: 'failed', retcode: 1200, data: null, wording: 'proxy: target unreachable' }));
    }
  });

  proxyReq.end(body);
}

function ffprobe(filePath) {
  const result = spawnSync(CFG.ffmpeg.ffprobePath, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    '-read_intervals', `%+${CFG.probeSampleSeconds}`,
    filePath,
  ], { timeout: 30000, encoding: 'utf8' });

  if (result.error || result.status !== 0) {
    throw new Error(`ffprobe failed: ${result.error?.message || result.stderr?.slice(0, 200)}`);
  }

  return JSON.parse(result.stdout);
}

function detectSceneChanges(filePath) {
  const result = spawnSync(CFG.ffmpeg.path, [
    '-i', filePath,
    '-t', String(CFG.probeSampleSeconds),
    '-vf', "select='gt(scene,0.1)',metadata=print",
    '-f', 'null',
    '-',
  ], { timeout: 60000, encoding: 'utf8' });

  if (result.error) {
    log('PROBE', 'scene detect warning: %s', result.error.message);
    return { sceneChanges: -1 };
  }

  const stderr = result.stderr || '';
  const matches = stderr.match(/Parsed_metadata.*?pts_time:\s*([\d.]+)/g) || [];
  const ptsTimes = matches.map(m => {
    const v = m.match(/pts_time:\s*([\d.]+)/);
    return v ? parseFloat(v[1]) : -1;
  }).filter(t => t >= 0);

  return { sceneChanges: ptsTimes.length, sceneTimes: ptsTimes };
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
      if (stat.size <= CFG.maxVideoSize) {
        fs.renameSync(attemptPath, outputPath);
        log('CRF', '%s succeeded: %d MB', g.label, Math.round(stat.size / 1048576));
        return;
      }
      log('CRF', '%s output %d MB > %d MB, trying next gradient',
        g.label, Math.round(stat.size / 1048576), Math.round(CFG.maxVideoSize / 1048576));
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
      '-shortest', '-map', '1:v', '-map', '0:a',
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

function compressSplit(inputPath, outputDir) {
  ensureDir(outputDir);
  const pattern = path.join(outputDir, 'chunk_%03d.mp4');
  const result = spawnSync(CFG.ffmpeg.path, [
    '-i', inputPath,
    '-c', 'copy', '-map', '0',
    '-f', 'segment', '-segment_time', '600',
    '-reset_timestamps', '1',
    '-y', pattern,
  ], { timeout: 300000, encoding: 'utf8' });

  if (result.error || result.status !== 0) {
    throw new Error(`split failed: ${result.error?.message || result.stderr?.slice(0, 200)}`);
  }

  const files = fs.readdirSync(outputDir)
    .filter(f => f.endsWith('.mp4'))
    .sort()
    .map(f => path.join(outputDir, f));

  return files;
}

async function compressVideo(inputPath, fileSize, durationSec) {
  const probeData = ffprobe(inputPath);
  const sceneData = detectSceneChanges(inputPath);
  const klass = classifyContent(probeData, sceneData, fileSize, durationSec);

  const estMin = estimateEncodingTime(probeData);
  log('COMPRESS', 'class=%s expected_encoding=~%d min content=%s', klass, Math.round(estMin), path.basename(inputPath));

  if (estMin > CFG.ffmpeg.maxEncodeMinutes && klass !== CLASS_ULTRA_REPETITIVE) {
    log('COMPRESS', 'encoding time ~%d min > max (%d min), falling back to split', Math.round(estMin), CFG.ffmpeg.maxEncodeMinutes);
    const splitDir = path.join(CFG.tempDir, 'chunks', uuid());
    const chunks = compressSplit(inputPath, splitDir);
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
    if (outStat.size > CFG.maxVideoSize) {
      log('COMPRESS', 'output %d MB still > %d MB, falling back to split', Math.round(outStat.size / 1048576), Math.round(CFG.maxVideoSize / 1048576));
      fs.unlinkSync(outputPath);
      const splitDir = path.join(CFG.tempDir, 'chunks', uuid());
      const chunks = compressSplit(inputPath, splitDir);
      return { type: 'split', files: chunks };
    }

    const cacheKey = md5File(inputPath) + '_' + fileSize;
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
    const chunks = compressSplit(inputPath, splitDir);
    return { type: 'split', files: chunks };
  }
}

function lookupCache(filePath, fileSize) {
  const cacheKey = md5File(filePath) + '_' + fileSize;
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

async function handleVideoInMessage(parsed) {
  const params = parsed.params || {};
  const msg = params.message || [];
  let modified = false;

  const newMsg = [];
  let pendingSplits = [];

  for (const elem of msg) {
    if (!elem || elem.type !== 'video') {
      newMsg.push(elem);
      continue;
    }

    const filePath = resolveSource(elem.data?.file);
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

      const cached = lookupCache(filePath, stat.size);
      if (cached && cached.type === 'single' && fs.existsSync(cached.file)) {
        const cachedStat = fs.statSync(cached.file);
        if (cachedStat.size <= CFG.maxVideoSize) {
          newMsg.push({
            type: 'video',
            data: { ...elem.data, file: cached.file },
          });
          modified = true;
          continue;
        }
      }

      const result = await compressVideo(filePath, stat.size, stat.size / (8 * 1024 * 1024));

      if (result.type === 'single') {
        newMsg.push({
          type: 'video',
          data: { ...elem.data, file: result.file },
        });
        modified = true;

      } else if (result.type === 'split') {
        pendingSplits.push({ files: result.files, originalData: elem.data });
      }

    } catch (err) {
      log('VIDEO', 'error processing %s: %s', elem.data?.file, err.message);
      newMsg.push(elem);
    }
  }

  if (!modified && pendingSplits.length === 0) return null;

  return {
    newMsg,
    pendingSplits,
    params,
    action: parsed.action,
    echo: parsed.echo,
  };
}

async function sendSplitChunks(action, params, splits, echo) {
  const lastResults = [];
  for (const split of splits) {
    for (const file of split.files) {
      const splitParams = { ...params, message: [{
        type: 'video',
        data: { ...split.originalData, file },
      }]};

      const body = JSON.stringify({ action, params: splitParams, echo });
      await forwardToOneBot(body);

      await sleep(200);
    }
  }
  return lastResults;
}

function forwardToOneBot(body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: CFG.targetHost,
      port: CFG.targetPort,
      path: CFG.targetPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    if (CFG.accessToken) {
      options.headers['Authorization'] = `Bearer ${CFG.accessToken}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c.toString());
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ status: 'failed' }); }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function handleRequest(clientReq, clientRes) {
  let body;
  try {
    body = await readBody(clientReq);
  } catch (err) {
    log('HTTP', 'read body error: %s', err.message);
    clientRes.writeHead(400, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ status: 'failed', retcode: 1400, data: null, wording: 'proxy: ' + err.message }));
    return;
  }

  const parsed = parseOneBotBody(body);
  if (!parsed) {
    passthrough(clientReq, clientRes, body);
    return;
  }

  if (!isVideoAction(parsed)) {
    passthrough(clientReq, clientRes, body);
    return;
  }

  log('HTTP', 'intercepted %s with video element(s)', parsed.action);

  try {
    const result = await handleVideoInMessage(parsed);

    if (!result) {
      log('HTTP', 'no oversized video, passthrough');
      passthrough(clientReq, clientRes, body);
      return;
    }

    if (result.pendingSplits.length > 0) {
      sendSplitChunks(result.action, result.params, result.pendingSplits, result.echo)
        .then(() => log('SPLIT', 'all chunks sent'))
        .catch(err => log('SPLIT', 'error: %s', err.message));
    }

    if (result.newMsg.length > 0) {
      const modifiedBody = JSON.stringify({
        action: result.action,
        params: { ...result.params, message: result.newMsg },
        echo: result.echo,
      });
      log('HTTP', 'forwarding compressed message (%d elements)', result.newMsg.length);
      passthrough(clientReq, clientRes, modifiedBody);
    } else {
      clientRes.writeHead(200, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({
        status: 'ok', retcode: 0, data: { message_id: 0 },
        wording: 'video split into multiple messages',
        echo: result.echo,
      }));
    }

  } catch (err) {
    log('HTTP', 'processing error: %s', err.message);
    passthrough(clientReq, clientRes, body);
  }
}

const server = http.createServer(handleRequest);

server.listen(CFG.listenPort, CFG.listenHost, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   SnowLuma Video Oversize Proxy         ║');
  console.log('  ║──────────────────────────────────────────║');
  console.log(`  ║   Listen : ${CFG.listenHost}:${CFG.listenPort}               ║`);
  console.log(`  ║   Target: ${CFG.target}                    ║`);
  console.log(`  ║   Temp  : ${CFG.tempDir}     ║`);
  console.log(`  ║   Limit : ${Math.round(CFG.maxVideoSize / 1048576)} MB → ≤${Math.round(CFG.maxOutputSize / 1048576)} MB             ║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
});

process.on('uncaughtException', (err) => {
  log('FATAL', 'uncaught: %s', err.message);
});

process.on('unhandledRejection', (err) => {
  log('FATAL', 'unhandled rejection: %s', err instanceof Error ? err.message : String(err));
});
