import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';

interface VncPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (password: string) => void;
}

export function VncPasswordDialog({ open, onOpenChange, onConfirm }: VncPasswordDialogProps) {
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!open) setPassword('');
  }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>VNC 密码</AlertDialogTitle>
          <AlertDialogDescription>
            请输入远程桌面的连接密码
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="password"
            placeholder="输入密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pl-9"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && password) {
                onConfirm(password);
                setPassword('');
              }
            }}
          />
        </div>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setPassword(''); }}>
            取消
          </Button>
          <Button disabled={!password} onClick={() => { onConfirm(password); setPassword(''); }}>
            连接
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
