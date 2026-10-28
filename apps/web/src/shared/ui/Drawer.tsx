import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Side drawer (RTL: slides in from the left edge, the content side). Closes on
 * Esc / backdrop, traps initial focus, and keeps a sticky footer for actions.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg';
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
      role="presentation"
      dir="rtl"
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex h-full w-full flex-col bg-white shadow-xl outline-none ${width === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg'} mr-auto`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-navy-100 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-navy">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-purple">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded-lg p-1.5 text-purple hover:bg-navy-50 hover:text-navy"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-navy-100 bg-navy-50/40 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
