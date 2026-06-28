import { Monitor } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface VncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VncDialog({ open, onOpenChange }: VncDialogProps) {
  const hostname = globalThis.location?.hostname ?? 'localhost';
  const vncUrl = `http://${hostname}:6081/vnc.html?autoconnect=1&resize=scale&reconnect=1`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1000px] w-[calc(100vw-2rem)] h-[80vh] max-h-[800px] flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Monitor className="size-4" />
            <DialogTitle>远程桌面</DialogTitle>
          </div>
          <p className="text-xs text-muted-foreground">
            通过 VNC 查看桌面环境，扫码登录 QQ
          </p>
        </DialogHeader>
        <div className="relative flex-1 min-h-0 overflow-hidden rounded-xl border bg-black">
          <iframe
            src={vncUrl}
            className="absolute inset-0 w-full h-full"
            allowFullScreen
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
