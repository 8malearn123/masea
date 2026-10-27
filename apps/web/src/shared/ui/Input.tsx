import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | undefined;
  /** Helper text under the field (shown when there is no error). */
  hint?: string | undefined;
  /** Unit shown inside the field end (e.g. «ر.س»، «يوم»). */
  suffix?: string | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, suffix, className = '', id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="block">
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-navy-900">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          {...rest}
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${inputId}-help` : undefined}
          className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm outline-none transition focus:ring-2 disabled:opacity-50 ${
            error
              ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15'
              : 'border-navy-100 focus:border-navy focus:ring-navy/15'
          } ${suffix ? 'pl-12' : ''} ${className}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-purple">
            {suffix}
          </span>
        )}
      </div>
      {error ? (
        <p id={`${inputId}-help`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-help`} className="mt-1 text-[11px] text-purple">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
