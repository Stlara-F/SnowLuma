import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import RFB from '@novnc/novnc';

export interface VncViewerHandle {
  sendCredentials: (creds: { password: string }) => void;
  disconnect: () => void;
}

interface VncViewerProps {
  scaleViewport?: boolean;
  onConnected?: () => void;
  onDisconnected?: (clean: boolean) => void;
  onCredentialsRequired?: () => void;
  onError?: (message: string) => void;
}

function safeDisconnect(rfb: RFB | null) {
  if (!rfb) return;
  try {
    rfb.disconnect();
  } catch {
    // RFB may already be disconnected — ignore
  }
}

export const VncViewer = forwardRef<VncViewerHandle, VncViewerProps>(
  ({ scaleViewport = true, onConnected, onDisconnected, onCredentialsRequired, onError }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const rfbRef = useRef<RFB | null>(null);
    const disconnectedRef = useRef(false);
    const [ticket, setTicket] = useState<string | null>(null);
    const onConnectedRef = useRef(onConnected);
    const onDisconnectedRef = useRef(onDisconnected);
    const onCredentialsRequiredRef = useRef(onCredentialsRequired);
    const onErrorRef = useRef(onError);
    useEffect(() => { onConnectedRef.current = onConnected; }, [onConnected]);
    useEffect(() => { onDisconnectedRef.current = onDisconnected; }, [onDisconnected]);
    useEffect(() => { onCredentialsRequiredRef.current = onCredentialsRequired; }, [onCredentialsRequired]);
    useEffect(() => { onErrorRef.current = onError; }, [onError]);

    // Obtain a short-lived VNC ticket from the backend instead of exposing
    // the long-lived session token in the WebSocket URL.
    useEffect(() => {
      let cancelled = false;
      const token = localStorage.getItem('snowluma_token');
      if (!token) {
        onErrorRef.current?.('登录信息已过期，请重新登录');
        return;
      }
      fetch('/api/vnc/ticket', { headers: { Authorization: 'Bearer ' + token } })
        .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
        .then((d) => { if (!cancelled) setTicket(d.ticket as string); })
        .catch(() => { if (!cancelled) onErrorRef.current?.('获取 VNC 凭证失败'); });
      return () => { cancelled = true; };
    }, []);

    const wsUrl = ticket
      ? `${globalThis.location?.protocol === 'https:' ? 'wss' : 'ws'}://${globalThis.location?.host}/api/vnc/ws?ticket=${ticket}`
      : null;

    useEffect(() => {
      if (!wsUrl) return;
      const container = containerRef.current;
      if (!container) return;

      container.innerHTML = '';
      disconnectedRef.current = false;

      const rfb = new RFB(container, wsUrl);
      rfbRef.current = rfb;
      rfb.scaleViewport = scaleViewport;
      rfb.qualityLevel = 6;
      rfb.compressionLevel = 2;

      console.log('[VncViewer] RFB created, connecting...');

      const isCustomEvent = (event: Event): event is CustomEvent => 'detail' in event;

      const onConnect = () => {
        console.log('[VncViewer] RFB connected');
        onConnectedRef.current?.();
      };
      const onDisconnect = (e: Event) => {
        disconnectedRef.current = true;
        let clean = true;
        if (isCustomEvent(e)) {
          const detailClean = (e as CustomEvent<{ clean?: boolean }>).detail?.clean;
          clean = detailClean !== false;
        }
        console.log('[VncViewer] RFB disconnected, clean:', clean);
        onDisconnectedRef.current?.(clean);
      };
      const onCredsRequired = () => {
        console.log('[VncViewer] RFB credentials required');
        onCredentialsRequiredRef.current?.();
      };
      const onSecurityFailure = (e: Event) => {
        let reason = '连接失败';
        if (isCustomEvent(e)) {
          const detailReason = (e as CustomEvent<{ reason?: string }>).detail?.reason;
          if (typeof detailReason === 'string' && detailReason.length > 0) {
            reason = detailReason;
          }
        }
        console.log('[VncViewer] RFB security failure:', reason);
        onErrorRef.current?.(reason);
      };

      rfb.addEventListener('connect', onConnect);
      rfb.addEventListener('disconnect', onDisconnect);
      rfb.addEventListener('credentialsrequired', onCredsRequired);
      rfb.addEventListener('securityfailure', onSecurityFailure);

      return () => {
        console.log('[VncViewer] cleanup');
        rfb.removeEventListener('connect', onConnect);
        rfb.removeEventListener('disconnect', onDisconnect);
        rfb.removeEventListener('credentialsrequired', onCredsRequired);
        rfb.removeEventListener('securityfailure', onSecurityFailure);
        if (!disconnectedRef.current) {
          disconnectedRef.current = true;
          safeDisconnect(rfb);
        }
        rfbRef.current = null;
      };
    }, [wsUrl, scaleViewport]);

    const sendCredentials = useCallback((creds: { password: string }) => {
      rfbRef.current?.sendCredentials({ username: '', password: creds.password, target: '' });
    }, []);

    const disconnect = useCallback(() => {
      const rfb = rfbRef.current;
      if (!rfb || disconnectedRef.current) return;
      disconnectedRef.current = true;
      console.log('[VncViewer] disconnect called externally');
      safeDisconnect(rfb);
      rfbRef.current = null;
    }, []);

    useImperativeHandle(ref, () => ({ sendCredentials, disconnect }), [sendCredentials, disconnect]);

    return <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden bg-black" />;
  }
);

VncViewer.displayName = 'VncViewer';
