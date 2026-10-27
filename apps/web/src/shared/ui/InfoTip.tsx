import { useId, useState } from 'react';
import { Info } from 'lucide-react';

/** Accessible tooltip for financial terms (hover, focus, or tap). */
export function InfoTip({ text, label = 'توضيح' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full text-purple hover:text-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-navy/40"
      >
        <Info size={13} />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full right-1/2 z-40 mb-1.5 w-56 translate-x-1/2 rounded-lg bg-navy-900 px-2.5 py-1.5 text-[11px] font-normal leading-relaxed text-white shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
