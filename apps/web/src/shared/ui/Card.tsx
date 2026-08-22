import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = '', ...rest }: CardProps) {
  return (
    <div {...rest} className={`rounded-2xl bg-white p-5 shadow-card ${className}`}>
      {children}
    </div>
  );
}
