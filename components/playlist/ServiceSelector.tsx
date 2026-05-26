'use client';

import { StreamingService } from '@/types';
import { cn } from '@/lib/utils';

interface ServiceSelectorProps {
  selected: StreamingService | null;
  onChange: (service: StreamingService) => void;
}

const SERVICES: { id: StreamingService; label: string; color: string; activeClass: string }[] = [
  {
    id: 'spotify',
    label: 'Spotify',
    color: '#1DB954',
    activeClass: 'border-[#1DB954] bg-[#1DB954]/10 text-[#1DB954]',
  },
  {
    id: 'apple-music',
    label: 'Apple Music',
    color: '#FA2D48',
    activeClass: 'border-[#FA2D48] bg-[#FA2D48]/10 text-[#FA2D48]',
  },
];

export function ServiceSelector({ selected, onChange }: ServiceSelectorProps) {
  return (
    <div className="flex gap-2">
      {SERVICES.map((svc) => (
        <button
          key={svc.id}
          onClick={() => onChange(svc.id)}
          className={cn(
            'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all duration-150',
            selected === svc.id
              ? svc.activeClass
              : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200',
          )}
        >
          {svc.label}
        </button>
      ))}
    </div>
  );
}
