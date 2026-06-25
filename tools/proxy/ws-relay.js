import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { CFG, log, readOneBotConfig } from './config.js';
import { safeSend, getVideoSource, resolveSource, parseOneBotBody, isVideoAction, sleep } from './utils.js';
import { compressVideo } from './compress.js';
import { lookupCache } from './cache.js';

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
      sendFn(JSON.stringify({
        action,
        params: { ...params, message: [{ type: 'video', data: { ...split.originalData, file } }] },
        echo,
      }));
      await sleep(200);
    }
  }
}

export function establishLink(downstream, req) {
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
      const { raw, parsed, sendFn } = msgQueue.shift();
      try {
        const handled = await processVideoInMessage(parsed);
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
      if (isBinary) { safeSend(downstream, data); return; }

      const raw = typeof data === 'string' ? data : data.toString();
      if (raw.length === 0 || (raw[0] !== '{' && raw[0] !== '[')) {
        safeSend(downstream, raw); return;
      }

      const parsed = parseOneBotBody(raw);
      if (!parsed) { safeSend(downstream, raw); return; }

      if (!isVideoAction(parsed)) { safeSend(downstream, raw); return; }

      log('WS', 'intercepted %s with video element(s)', parsed.action);
      msgQueue.push({ raw, parsed, sendFn: b => safeSend(downstream, b) });
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

  downstream.on('message', (data) => {
    if (upstream?.readyState === WebSocket.OPEN) {
      safeSend(upstream, data);
    } else if (pendingDownstream.length < MAX_PENDING) {
      pendingDownstream.push(data);
    }
  });

  downstream.on('close', () => {
    log('WS', 'downstream disconnected');
    cleanup();
  });

  downstream.on('error', () => cleanup());

  connectUpstream();
}
