export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
        <div className="h-full w-1/4 bg-brand-500 motion-safe:animate-toploader-sweep" />
      </div>
      <div className="h-7 w-40 animate-pulse rounded bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200/70" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-xl bg-slate-200/70" />
    </div>
  );
}
