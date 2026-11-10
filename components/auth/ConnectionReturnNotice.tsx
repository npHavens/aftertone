'use client';
import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// Outcomes a provider sign-in redirect sends back, from the backend or the local API proxy.
const connectionMessages = new Map([
  ['cancelled', 'Connection was cancelled. Connect your music service when you are ready.'],
  ['expired', 'That connection attempt expired. Please connect your music service again.'],
  ['failed', 'The music service did not complete the connection. Please try again.'],
  [
    'unavailable',
    'Aftertone could not connect your music service right now. Please try again in a minute.',
  ],
  ['rate_limited', 'Too many connection attempts. Wait a minute and try again.'],
  [
    'setup',
    'Aftertone is not set up to connect this music service. Check the local server configuration.',
  ],
]);

type Props = { connected: boolean };

function ReturnNotice({ connected }: Props) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  // Read once, because the parameter is removed below so that a reload doesn't repeat it.
  const [message, setMessage] = useState(() =>
    connectionMessages.get(params.get('connection') ?? ''),
  );
  // A later connection makes the notice out of date, and it stays dismissed after disconnecting.
  if (connected && message) setMessage(undefined);
  useEffect(() => {
    if (!params.has('connection')) return;
    // Through the router, not history.replaceState: on the first render this effect runs before
    // the router hooks into history, so the router would keep the old URL and restore it later.
    const remaining = new URLSearchParams(params);
    remaining.delete('connection');
    const search = remaining.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }, [params, pathname, router]);
  if (!message) return null;
  return (
    <div className="alert" role="alert">
      {message}
    </div>
  );
}
export function ConnectionReturnNotice({ connected }: Props) {
  return (
    <Suspense fallback={null}>
      <ReturnNotice connected={connected} />
    </Suspense>
  );
}
