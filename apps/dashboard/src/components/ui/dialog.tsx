import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from '../../lib/utils.ts';

const Dialog = DialogPrimitive.Root;
const DialogClose = DialogPrimitive.Close;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

function DialogContent({ className, ...props }: DialogPrimitive.Popup.Props) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Backdrop className="dialog-backdrop" />
    <DialogPrimitive.Popup data-slot="dialog-content" className={cn('dialog-content', className)} {...props} />
  </DialogPrimitive.Portal>;
}

export { Dialog, DialogClose, DialogContent, DialogTitle, DialogDescription };
