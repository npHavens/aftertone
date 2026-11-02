'use client';

export function ScanProgress() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6">
      {/* Spinning vinyl */}
      <div className="animate-[vinyl-spin_2s_linear_infinite]">
        <svg viewBox="0 0 80 80" className="h-16 w-16 text-amber-500" fill="currentColor">
          <circle cx="40" cy="40" r="38" />
          <circle cx="40" cy="40" r="32" fill="#18181b" />
          <circle cx="40" cy="40" r="24" opacity="0.4" />
          <circle cx="40" cy="40" r="16" fill="#18181b" />
          <circle cx="40" cy="40" r="8" opacity="0.3" />
          <circle cx="40" cy="40" r="3.5" fill="#27272a" />
          <circle cx="40" cy="40" r="1.5" fill="currentColor" opacity="0.9" />
        </svg>
      </div>

      {/* Scanning text with dots */}
      <p className="text-xs font-medium text-zinc-400">
        Identifying album
        <span className="scan-dots" />
      </p>

      {/* Progress bar */}
      <div className="h-0.5 w-24 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full w-full origin-left animate-[pulse_1.5s_ease-in-out_infinite] bg-amber-500/60" />
      </div>
    </div>
  );
}
