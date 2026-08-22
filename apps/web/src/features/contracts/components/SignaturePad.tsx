import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Canvas signature pad. Emits a PNG data URL on each completed stroke. */
export function SignaturePad({
  label,
  onChange,
}: {
  label: string;
  onChange: (dataUrl: string | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);

  function ctx(): CanvasRenderingContext2D | null {
    return ref.current?.getContext('2d') ?? null;
  }
  function pos(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const c = ref.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function start(e: ReactPointerEvent<HTMLCanvasElement>) {
    const g = ctx();
    if (!g) return;
    drawing.current = true;
    const p = pos(e);
    g.beginPath();
    g.moveTo(p.x, p.y);
  }
  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const g = ctx();
    if (!g) return;
    const p = pos(e);
    g.lineTo(p.x, p.y);
    g.strokeStyle = '#120E45';
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.stroke();
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    setSigned(true);
    onChange(ref.current?.toDataURL('image/png') ?? null);
  }
  function clear() {
    const c = ref.current;
    const g = ctx();
    if (c && g) g.clearRect(0, 0, c.width, c.height);
    setSigned(false);
    onChange(null);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium text-navy-900">{label}</span>
        <button type="button" onClick={clear} className="text-xs text-purple hover:text-navy">
          مسح
        </button>
      </div>
      <canvas
        ref={ref}
        width={320}
        height={120}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        style={{ touchAction: 'none' }}
        className={`w-full rounded-xl border bg-white ${signed ? 'border-navy' : 'border-dashed border-navy-100'}`}
      />
    </div>
  );
}
