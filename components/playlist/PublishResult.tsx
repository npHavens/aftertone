import { serviceLink } from '@/lib/api';
import type { PlaylistOperation } from '@/types';

interface Props {
  operation: PlaylistOperation | null;
  busy: boolean;
  service: string;
  onCheck: () => void;
  onNewMix: (acknowledged?: boolean) => void;
  onEditMix: () => void;
}

export function PublishResult({ operation, busy, service, onCheck, onNewMix, onEditMix }: Props) {
  const status = operation?.status;
  const link = serviceLink(operation?.playlistUrl);
  return (
    <div className={`result ${status === 'completed' ? 'success' : ''}`} role="status">
      <h3>
        {status === 'completed'
          ? 'Back in rotation.'
          : status === 'processing'
            ? 'Your mix is on its way.'
            : status === 'failed'
              ? 'Your playlist wasn’t created.'
              : 'Let’s check that request.'}
      </h3>
      <p>
        {operation?.message ||
          (operation
            ? `${operation.addedCount} tracks added.`
            : 'We haven’t confirmed the outcome. Your exact request stays frozen so you can check it safely before starting another mix.')}
      </p>
      {link && (
        <a className="button" target="_blank" rel="noreferrer" href={link}>
          Open in {service} ↗
        </a>
      )}
      {(!operation || status === 'processing' || status === 'needs_attention') && (
        <button className="button secondary" disabled={busy} onClick={onCheck}>
          {operation ? 'Check playlist status' : 'Check same request'}
        </button>
      )}
      {status === 'processing' && (
        <p className="helper">
          We check automatically for a short time. You can check again here if it takes longer.
        </p>
      )}
      {status === 'failed' && (
        <button className="text-button" disabled={busy} onClick={onEditMix}>
          Edit this mix
        </button>
      )}
      {status === 'completed' && (
        <button className="text-button" disabled={busy} onClick={() => onNewMix()}>
          Start a new mix
        </button>
      )}
      {status === 'needs_attention' && (
        <>
          <p className="helper">
            Some music may already be saved. Check your music service before starting again.
            Starting a new mix leaves this playlist as it is and does not retry missing tracks.
          </p>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  'I have checked my music service and understand a playlist may already exist. Clear this local result and start a new mix? This will not retry or remove any saved music.',
                )
              )
                onNewMix(true);
            }}
          >
            I’ve checked — start a new mix
          </button>
        </>
      )}
    </div>
  );
}
