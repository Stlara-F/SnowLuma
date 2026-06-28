import { useCallback, useState } from 'react';

const STORAGE_KEY = 'snowluma_vnc_port';
const DEFAULT_PORT = 6081;

function readPort(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_PORT;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

export function useVncPort(): [port: number, setPort: (port: number) => void] {
  const [port, setPortState] = useState(readPort);

  const setPort = useCallback((next: number) => {
    const clamped = Math.max(1, Math.min(65535, Math.round(next)));
    try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch { /* noop */ }
    setPortState(clamped);
  }, []);

  return [port, setPort];
}
