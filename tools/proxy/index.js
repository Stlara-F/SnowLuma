#!/usr/bin/env node

import { WebSocketServer } from 'ws';
import { CFG, log } from './config.js';
import { establishLink } from './ws-relay.js';

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

process.on('uncaughtException', (err) => {
  log('FATAL', 'uncaught: %s', err.message);
});

process.on('unhandledRejection', (err) => {
  log('FATAL', 'unhandled rejection: %s', err instanceof Error ? err.message : String(err));
});
