import { useId, type ButtonHTMLAttributes } from 'react';
import { useToast } from './Toast';

export interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'aria-disabled'> {
  blockedReason?: string | false;
}

export function ActionButton({ blockedReason, onClick, children, type = 'button', 'aria-describedby': describedBy, ...props }: ActionButtonProps) {
  const { toast } = useToast();
  const id = useId();
  const reason = blockedReason || undefined;
  const description = [describedBy, reason ? id : undefined].filter(Boolean).join(' ') || undefined;
  return <>
    <button {...props} type={type} aria-disabled={reason ? true : undefined} aria-describedby={description}
      onClick={(event) => {
        if (reason) {
          event.preventDefault();
          event.stopPropagation();
          toast(reason, 'default', 8000);
          return;
        }
        onClick?.(event);
      }}>{children}</button>
    {reason && <span className="sr-only" id={id}>{reason}</span>}
  </>;
}
