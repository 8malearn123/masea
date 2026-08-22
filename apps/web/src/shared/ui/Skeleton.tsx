export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-navy-100/60 ${className}`} aria-hidden="true" />;
}

/** Convenience: a card-shaped loading placeholder. */
export function SkeletonCard() {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-card">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-8 w-32" />
    </div>
  );
}
