#!/usr/bin/env node

/**
 * send-large-video.mjs
 *
 * 外部脚本：将大视频分割为 ≤95MB 的分片，通过 SnowLuma OneBot HTTP API 串行发送。
 * 不修改任何 SnowLuma 核心代码，仅依赖 ffmpeg/ffprobe 和 Node.js 内置模块。
 *
 * 用法:
 *   node tools/send-large-video.mjs --input <视频路径> --group <群号>
 *   node tools/send-large-video.mjs --input ./movie.mp4 --group 123456 --config-dir ./config
 *
 * 依赖:
 *   - ffmpeg + ffprobe（需要能在 PATH 中找到）
 *   - Node.js >= 18（内置 fetch）
 */

import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// ──────────── 常量 ────────────

const MAX_BYTES_PER_SEGMENT = 95 * 1024 * 1024;
const MAX_SEGMENTS = 5;
const OVERLAP_SECONDS = 1.0;
const RETRY_COUNT = 2;
const RETRY_INTERVAL_MS = 15_000;

// ──────────── 已知错误映射 ────────────

const KNOWN_ERRORS = [
  { pattern: /ETIMEDOUT|ECONNREFUSED|fetch failed/i,
    message: '无法连接到 SnowLuma HTTP API——请检查 OneBot HTTP 服务是否已启用且端口正确' },
  { pattern: /retcode.*(?:100|101|102|103|104)/i,
    message: 'SnowLuma API 返回错误——参数错误或请求被拒绝' },
  { pattern: /ffprobe.*not found|spawn.*ffprobe.*ENOENT/i,
    message: '未找到 ffprobe——请确保 FFmpeg 已安装且在 PATH 中' },
  { pattern: /ffmpeg.*not found|spawn.*ffmpeg.*ENOENT/i,
    message: '未找到 ffmpeg——请确保 FFmpeg 已安装且在 PATH 中' },
  { pattern: /Invalid data found when processing/i,
    message: '输入文件不是有效的视频文件或已损坏' },
  { pattern: /No such file/i,
    message: '输入文件不存在——请检查文件路径' },
  { pattern: /status.*(?:failed|error)/i,
    message: 'SnowLuma 返回失败状态——请查看日志了解详情' },
  { pattern: /HTTP.*413/i,
    message: '视频文件超过 SnowLuma 的 100MB 限制——分片可能未正确分割，请检查' },
  { pattern: /HTTP.*401|HTTP.*403/i,
    message: 'API 鉴权失败——请确认 access_token 配置正确' },
  { pattern: /connect ECONNREFUSED/i,
    message: '连接被拒绝——请确认 SnowLuma 正在运行且 HTTP 端口正确' },
];

function matchKnownError(msg) {
  if (!msg) return null;
  for (const known of KNOWN_ERRORS) {
    if (known.pattern.test(msg)) return known.message;
  }
  return null;
}

// ──────────── 日志 ────────────

function log(level, msg, ...args) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = `[${ts}] [${level.padEnd(5)}]`;
  console.log(args.length > 0 ? `${prefix} ${msg} ${args.join(' ')}` : `${prefix} ${msg}`);
}

// ──────────── 工具函数 ────────────

function checkTool(name) {
  try {
    const result = spawnSync(name, ['-version'], { stdio: 'pipe', timeout: 10_000 });
    return result.status === 0;
  } catch {
    return false;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

// ──────────── Step 1: 读取 OneBot 配置 ────────────

function findOneBotConfig(configDir) {
  if (!existsSync(configDir)) {
    throw new Error(`配置目录不存在: ${configDir}`);
  }

  const files = readdirSync(configDir).filter(f => /^onebot_\d+\.json$/.test(f));
  if (files.length === 0) {
    throw new Error(`在 ${configDir} 中未找到 onebot_*.json 配置文件`);
  }

  for (const file of files) {
    const raw = readFileSync(path.join(configDir, file), 'utf-8');
    const cfg = JSON.parse(raw);
    const servers = cfg?.networks?.httpServers ?? [];
    const enabled = servers.find(s => s.enabled !== false);
    if (enabled) return { uin: file.match(/\d+/)[0], ...enabled };
  }

  throw new Error('未找到已启用的 HTTP 服务——请先在 WebUI 中启用一个 HTTP Server 适配器');
}

// ──────────── Step 2: 探测视频 ────────────

function probeVideo(inputPath) {
  log('INFO', `正在探测视频: ${inputPath}`);

  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration,size,bit_rate',
    '-of', 'json',
    inputPath,
  ], { encoding: 'utf-8', timeout: 30_000 });
  if (result.status !== 0) {
    throw new Error(result.stderr || `ffprobe 退出码 ${result.status}`);
  }
  const info = JSON.parse(result.stdout);

  const size = parseInt(info.format.size, 10);
  const duration = parseFloat(info.format.duration);
  const bitRate = info.format.bit_rate
    ? parseInt(info.format.bit_rate, 10)
    : Math.round(size * 8 / duration);

  if (!size || size <= 0) throw new Error('无法获取视频文件大小');
  if (!duration || duration <= 0) throw new Error('无法获取视频时长');

  log('INFO', `  大小: ${formatBytes(size)}, 时长: ${formatDuration(duration)}, 码率: ${(bitRate / 1000).toFixed(0)} kbps`);

  return { size, duration, bitRate };
}

// ──────────── Step 3: 计算分片参数 ────────────

function calculateSegments(totalSize, totalDuration) {
  const numSegments = Math.ceil(totalSize / MAX_BYTES_PER_SEGMENT);

  log('INFO', `  所需最少分段: ${numSegments}`);

  if (numSegments > MAX_SEGMENTS) {
    log('WARN', `  ⚠ 预计需要 ${numSegments} 段，超过建议上限 ${MAX_SEGMENTS}，将继续尝试`);
  }

  if (numSegments <= 1) {
    return [{ index: 0, start: 0, duration: totalDuration }];
  }

  const baseDuration = totalDuration / numSegments;
  const segments = [];

  for (let i = 0; i < numSegments; i++) {
    const start = Math.max(0, i * baseDuration - (i > 0 ? OVERLAP_SECONDS : 0));
    const end = Math.min(totalDuration, (i + 1) * baseDuration);
    segments.push({ index: i, start, duration: end - start });
  }

  const segSize = totalSize / numSegments;
  log('INFO', `  每段平均大小: ${formatBytes(segSize)}, 每段基准时长: ${formatDuration(baseDuration)}`);
  log('INFO', `  段间重叠: ${OVERLAP_SECONDS}s`);

  return segments;
}

// ──────────── Step 4: FFmpeg 分割 ────────────

function splitSegment(inputPath, outputPath, start, duration) {
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

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 });
    let stderr = '';

    proc.stdout.on('data', () => {});
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        const realSize = statSync(outputPath).size;
        if (realSize === 0) return reject(new Error('ffmpeg 输出文件为空'));
        resolve(realSize);
      } else {
        reject(new Error(`ffmpeg 退出码 ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => reject(new Error(`ffmpeg 启动失败: ${err.message}`)));
  });
}

// ──────────── Step 5: 通过 OneBot HTTP API 发送 ────────────

async function sendSegment(apiBase, token, groupId, filePath, fileName, isRetry) {
  const url = `${apiBase}/send_group_msg`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const body = JSON.stringify({
    group_id: groupId,
    message: [{
      type: 'video',
      data: { file: filePath, fileName },
    }],
  });

  const label = isRetry ? `[第${isRetry}次重试]` : '[首次发送]';
  log('INFO', `  → ${label} ${fileName}`);

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(300_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const result = await resp.json();

  if (result?.status === 'ok' && result?.retcode === 0) {
    const msgId = result?.data?.message_id ?? '?';
    log('INFO', `  ✓ ${label} ${fileName} → message_id=${msgId}`);
    return msgId;
  }

  const errMsg = result?.message ?? result?.wording ?? JSON.stringify(result);
  throw new Error(`API 返回错误: ${errMsg} (retcode=${result?.retcode})`);
}

// ──────────── 主流程 ────────────

async function main() {
  // ── 参数解析 ──
  const args = {};
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].startsWith('--')) {
      const key = raw[i].slice(2);
      args[key] = (i + 1 < raw.length && !raw[i + 1].startsWith('--')) ? raw[i + 1] : true;
      if (args[key] !== true) i++;
    }
  }

  const inputPath = args.input || args.i;
  const groupId = args.group || args.g;
  const configDir = args['config-dir'] || path.join(process.cwd(), 'config');
  const apiBaseOverride = args['api-base'];

  const errs = [];
  if (!inputPath) errs.push('--input <视频路径> 必填');
  if (!groupId) errs.push('--group <群号> 必填');
  if (errs.length > 0) {
    console.log('用法: node tools/send-large-video.mjs --input <视频路径> --group <群号>');
    console.log('                 [--api-base <http://host:port>] [--config-dir <配置目录>]');
    errs.forEach(e => console.log(`  错误: ${e}`));
    process.exit(1);
  }

  const absInput = path.resolve(inputPath);
  const groupNum = Number(groupId);
  if (!Number.isSafeInteger(groupNum) || groupNum <= 0) {
    log('ERROR', `群号无效: ${groupId}`);
    process.exit(1);
  }

  log('INFO', '═══════════════════════════════════════');
  log('INFO', '  大视频分割上传工具');
  log('INFO', '═══════════════════════════════════════');
  log('INFO', `输入: ${absInput}`);
  log('INFO', `目标群: ${groupNum}`);

  // ── 检查工具 ──
  if (!checkTool('ffprobe')) {
    log('ERROR', '未找到 ffprobe——请安装 FFmpeg 并将其添加到 PATH');
    process.exit(1);
  }
  if (!checkTool('ffmpeg')) {
    log('ERROR', '未找到 ffmpeg——请安装 FFmpeg 并将其添加到 PATH');
    process.exit(1);
  }
  log('INFO', 'FFmpeg 检测通过');

  // ── 检查输入文件 ──
  if (!existsSync(absInput)) {
    log('ERROR', `输入文件不存在: ${absInput}`);
    process.exit(1);
  }

  // ── 发现 OneBot API ──
  let apiBase = apiBaseOverride;
  let token = '';
  if (!apiBase) {
    try {
      const httpCfg = findOneBotConfig(configDir);
      const host = httpCfg.host || '127.0.0.1';
      apiBase = `http://${host}:${httpCfg.port}`;
      token = httpCfg.accessToken || '';
      log('INFO', `发现 OneBot HTTP API: ${apiBase} (UIN=${httpCfg.uin})`);
    } catch (err) {
      const known = matchKnownError(err.message);
      log('ERROR', `读取配置失败: ${known || err.message}`);
      log('ERROR', '可用 --api-base <URL> 手动指定 API 地址');
      process.exit(1);
    }
  } else {
    log('INFO', `OneBot HTTP API: ${apiBase} (手动指定)`);
  }

  // ── 验证 API 连通性 ──
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const testUrl = `${apiBase}/get_version_info`;
    const testResp = await fetch(testUrl, { headers, signal: AbortSignal.timeout(5_000) });
    if (testResp.ok) {
      const info = await testResp.json();
      log('INFO', `API 连通 ✅ (${info?.data?.app_name ?? 'OK'})`);
    } else {
      log('WARN', `API 返回状态 ${testResp.status}——请检查 access_token 与端口`);
    }
  } catch (err) {
    const known = matchKnownError(err.message);
    log('WARN', `API 连通性检查失败: ${known || err.message}`);
    log('WARN', '将继续尝试发送（如果确认 API 可用可忽略此警告）');
  }

  // ── 探测视频 ──
  let videoInfo;
  try {
    videoInfo = probeVideo(absInput);
  } catch (err) {
    const known = matchKnownError(err.message);
    log('ERROR', `视频探测失败: ${known || err.message}`);
    process.exit(1);
  }

  // ── 无需分片或直接处理 ──
  const ts = Date.now();
  const ext = path.extname(absInput);
  const baseName = path.basename(absInput, ext);

  if (videoInfo.size <= MAX_BYTES_PER_SEGMENT) {
    log('INFO', '视频 ≤ 95MB，直接发送...');
    const fileName = `${baseName}_${ts}${ext}`;
    let lastError = null;
    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
      try {
        await sendSegment(apiBase, token, groupNum, absInput, fileName, attempt);
        log('INFO', '');
        log('INFO', '✓ 发送完成');
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < RETRY_COUNT) {
          log('WARN', `  发送失败: ${matchKnownError(err.message) || err.message}`);
          log('WARN', `    ${RETRY_INTERVAL_MS / 1000}s 后重试...`);
          await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
        }
      }
    }
    if (lastError) {
      const known = matchKnownError(lastError.message);
      log('ERROR', `发送失败: ${known || lastError.message}`);
      process.exit(1);
    }
    return;
  }

  // ── 计算分片 ──
  const segments = calculateSegments(videoInfo.size, videoInfo.duration);

  // ── 创建临时目录 ──
  const tempDir = mkdtempSync(path.join(tmpdir(), 'sl-video-'));
  log('INFO', `临时目录: ${tempDir}`);

  const segmentFiles = [];
  const results = [];

  try {
    // ── 分割 ──
    log('INFO', `开始分割为 ${segments.length} 段...`);
    log('INFO', '  分段详情:');
    for (const seg of segments) {
      const segFileName = `${baseName}_${ts}_part${seg.index + 1}.mp4`;
      const segPath = path.join(tempDir, segFileName);
      log('INFO', `    段 ${seg.index + 1}: start=${seg.start.toFixed(1)}s, 时长=${seg.duration.toFixed(1)}s, 输出=${segFileName}`);
      const realSize = await splitSegment(absInput, segPath, seg.start, seg.duration);
      log('INFO', `    ✓ 段 ${seg.index + 1} 分割完成, 大小=${formatBytes(realSize)}`);
      if (realSize > MAX_BYTES_PER_SEGMENT) {
        log('WARN', `    ⚠ 段 ${seg.index + 1} 超过 ${formatBytes(MAX_BYTES_PER_SEGMENT)} (${formatBytes(realSize)})，可能会被 SnowLuma 拒绝`);
      }
      segmentFiles.push({ path: segPath, name: segFileName });
    }

    // ── 串行上传 ──
    log('INFO', '');
    log('INFO', '开始上传（串行，每次 ~95MB 峰值内存）...');

    for (let i = 0; i < segmentFiles.length; i++) {
      const file = segmentFiles[i];
      const label = `第 ${i + 1}/${segmentFiles.length} 段`;
      let lastError = null;
      let success = false;

      for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
        try {
          const msgId = await sendSegment(apiBase, token, groupNum, file.path, file.name, attempt);
          results.push({ index: i, fileName: file.name, messageId: msgId, success: true });
          success = true;
          break;
        } catch (err) {
          lastError = err;
          const known = matchKnownError(err.message);
          if (attempt < RETRY_COUNT) {
            log('WARN', `  ✗ ${label} 失败: ${known || err.message}`);
            log('WARN', `    ${RETRY_INTERVAL_MS / 1000}s 后第 ${attempt + 1} 次重试...`);
            await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
          }
        }
      }

      if (!success) {
        const known = matchKnownError(lastError.message);
        log('ERROR', `  ✗ ${label} 已放弃: ${known || lastError.message}`);
        results.push({ index: i, fileName: file.name, success: false, error: known || lastError.message });
      }
    }

    // ── 结果汇总 ──
    log('INFO', '');
    log('INFO', '═══════════════════════════════════════');
    log('INFO', '  上传结果汇总');
    log('INFO', '═══════════════════════════════════════');
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    log('INFO', `  总计: ${results.length} 段, 成功: ${succeeded}, 失败: ${failed}`);

    for (const r of results) {
      if (r.success) {
        log('INFO', `  ✓ ${r.fileName} → message_id=${r.messageId}`);
      } else {
        log('ERROR', `  ✗ ${r.fileName} → ${r.error}`);
      }
    }

    if (failed > 0) {
      log('WARN', '');
      log('WARN', '部分分段发送失败，可手动重试这些段。');
      log('WARN', '已在群内的成功分段不会被撤回。');
    }
    log('INFO', '═══════════════════════════════════════');

  } finally {
    // ── 清理 ──
    try { rmSync(tempDir, { recursive: true, force: true }); log('DEBUG', '临时文件已清理'); } catch { /* ok */ }
  }

  if (segmentFiles.some((_, i) => {
    const r = results.find(rr => rr.index === i);
    return r && !r.success;
  })) {
    process.exit(2);
  }
}

main().catch((err) => {
  const known = matchKnownError(err.message);
  log('ERROR', `未捕获的异常: ${known || err.message}`);
  if (!known) log('ERROR', err.stack);
  process.exit(1);
});
