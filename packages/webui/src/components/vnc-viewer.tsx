import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import RFB from '@novnc/novnc';

export interface VncViewerHandle {
  sendCredentials: (creds: { password: string }) => void;
}

interface VncViewerProps {
  hostname: string;
  port: number;
  protocol?: 'ws' | 'wss';
  scaleViewport?: boolean;
  onConnected?: () => void;
  onDisconnected?: (clean: boolean) => void;
  onCredentialsRequired?: () => void;
  onError?: (message: string) => void;
}

export const VncViewer = forwardRef<VncViewerHandle, VncViewerProps>(
  ({ hostname, port, protocol = 'ws', scaleViewport = true, onConnected, onDisconnected, onCredentialsRequired, onError }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const rfbRef = useRef<RFB | null>(null);
    const onConnectedRef = useRef(onConnected);
    const onDisconnectedRef = useRef(onDisconnected);
    const onCredentialsRequiredRef = useRef(onCredentialsRequired);
    const onErrorRef = useRef(onError);
    useEffect(() => { onConnectedRef.current = onConnected; });
    useEffect(() => { onDisconnectedRef.current = onDisconnected; });
    useEffect(() => { onCredentialsRequiredRef.current = onCredentialsRequired; });
    useEffect(() => { onErrorRef.current = onError; });

    const wsUrl = `${protocol}://${hostname}:${port}/websockify`;

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      container.innerHTML = '';

      const rfb = new RFB(container, wsUrl);
      rfbRef.current = rfb;
      rfb.scaleViewport = scaleViewport;
      rfb.resizeSession = true;
      rfb.qualityLevel = 6;
      rfb.compressionLevel = 2;

      const isCustomEvent = (event: Event): event is CustomEvent => 'detail' in event;

      const onConnect = () => { onConnectedRef.current?.(); };
      const onDisconnect = (e: Event) => {
        let clean = true;
        if (isCustomEvent(e)) {
          const detailClean = (e as CustomEvent<{ clean?: boolean }>).detail?.clean;
          clean = detailClean !== false;
        }
        onDisconnectedRef.current?.(clean);
      };
      const onCredsRequired = () => { onCredentialsRequiredRef.current?.(); };
      const onSecurityFailure = (e: Event) => {
        let reason = '连接失败';
        if (isCustomEvent(e)) {
          const detailReason = (e as CustomEvent<{ reason?: string }>).detail?.reason;
          if (typeof detailReason === 'string' && detailReason.length > 0) {
            reason = detailReason;
          }
        }
        onErrorRef.current?.(reason);
      };

      rfb.addEventListener('connect', onConnect);
      rfb.addEventListener('disconnect', onDisconnect);
      rfb.addEventListener('credentialsrequired', onCredsRequired);
      rfb.addEventListener('securityfailure', onSecurityFailure);

      return () => {
        rfb.removeEventListener('connect', onConnect);
        rfb.removeEventListener('disconnect', onDisconnect);
        rfb.removeEventListener('credentialsrequired', onCredsRequired);
        rfb.removeEventListener('securityfailure', onSecurityFailure);
        rfb.disconnect();
        rfbRef.current = null;
      };
    }, [wsUrl, scaleViewport]);

    const sendCredentials = useCallback((creds: { password: string }) => {
      rfbRef.current?.sendCredentials({ username: '', password: creds.password, target: '' });
    }, []);

    useImperativeHandle(ref, () => ({ sendCredentials }), [sendCredentials]);

    return <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden bg-black" />;
  }
);

VncViewer.displayName = 'VncViewer';
