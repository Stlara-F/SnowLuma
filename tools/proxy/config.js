import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

function validateConfig(cfg) {
  const errs = [];
  if (typeof cfg.listen !== 'string' || !cfg.listen.includes(':'))
    errs.push('listen must be in host:port format');
  if (typeof cfg.maxVideoSize !== 'number' || cfg.maxVideoSize <= 0)
    errs.push('maxVideoSize must be positive');
  if (typeof cfg.maxOutputSize !== 'number' || cfg.maxOutputSize <= 0)
    errs.push('maxOutputSize must be positive');
  if (cfg.maxOutputSize >= cfg.maxVideoSize)
    errs.push('maxOutputSize must be less than maxVideoSize');
  if (cfg.timeoutMs < 60000)
    errs.push('timeoutMs too low (<60000)');
  if (typeof cfg.ffmpeg.path !== 'string' || !cfg.ffmpeg.path)
    errs.push('ffmpeg.path must be a string');
  if (typeof cfg.ffmpeg.ffprobePath !== 'string' || !cfg.ffmpeg.ffprobePath)
    errs.push('ffmpeg.ffprobePath must be a string');
  if (errs.length) {
    console.error('[proxy] Config validation failed:');
    errs.forEach(e => console.error('  -', e));
    process.exit(1);
  }
}

function loadConfig() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const cfgPath = path.join(__dirname, '..', 'proxy-config.json');

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
  validateConfig(merged);

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

export const CFG = loadConfig();

export const log = (tag, msg, ...args) => {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}][proxy:${tag}] ${msg}`, ...args);
};

export function readOneBotConfig(selfId) {
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
