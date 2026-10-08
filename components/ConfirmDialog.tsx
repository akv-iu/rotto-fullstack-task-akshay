'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './ui';

/** In-app confirmation (never the browser's confirm()). */
export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onOpenChange }: {
  open: boolean; title: string; body: string; confirmLabel: string; onConfirm: () => void; onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-6 shadow-2xl">
          <Dialog.Title className="font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">{body}</Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild><Button>Cancel</Button></Dialog.Close>
            <Button variant="primary" onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
