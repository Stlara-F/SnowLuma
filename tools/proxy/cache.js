import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CFG, log } from './config.js';

export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export async function lookupCache(filePath, fileSize) {
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

export function cleanCache() {
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
