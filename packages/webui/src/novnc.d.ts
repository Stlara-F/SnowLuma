declare module '@novnc/novnc' {
  interface NoVncCredentials {
    username?: string;
    password?: string;
    target?: string;
  }

  interface NoVncOptions {
    shared?: boolean;
    credentials?: NoVncCredentials;
    repeaterID?: string;
    wsProtocols?: string[];
  }

  export default class RFB extends EventTarget {
    constructor(target: Element, url: string, options?: NoVncOptions);
    viewOnly: boolean;
    focusOnClick: boolean;
    clipViewport: boolean;
    dragViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;
    readonly capabilities: { power: boolean };
    readonly clippingViewport: boolean;
    disconnect(): void;
    sendCredentials(credentials: NoVncCredentials): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    sendCtrlAltDel(): void;
    focus(options?: FocusOptions): void;
    blur(): void;
    clipboardPasteFrom(text: string): void;
    toDataURL(type?: string, encoderOptions?: number): string;
    toBlob(callback: (blob: Blob) => void, type?: string, quality?: number): void;
  }
}
