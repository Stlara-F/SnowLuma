import crypto from 'crypto';
import { WebSocket } from 'ws';

export function uuid() {
  return crypto.randomUUID();
}

export function safeSend(ws, data) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  } catch {}
}

export function getVideoSource(elem) {
  if (!elem || !elem.data) return null;
  return elem.data.file || elem.data.url || elem.data.path || elem.data.media || null;
}

export function resolveSource(source) {
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

export function parseOneBotBody(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

export function isVideoAction(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const action = parsed.action || '';
  const valid = ['send_group_msg', 'send_private_msg'].includes(action);
  if (!valid) return false;
  const msg = parsed.params?.message;
  if (!Array.isArray(msg)) return false;
  return msg.some(e => e && e.type === 'video' && getVideoSource(e));
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
