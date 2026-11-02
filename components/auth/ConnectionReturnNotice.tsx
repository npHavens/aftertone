'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

// Outcomes the backend sends back from a provider sign-in redirect.
const connectionMessages = new Map([
  ['cancelled', 'Connection was cancelled. Connect your music service when you are ready.'],
  ['expired', 'That connection attempt expired. Please connect your music service again.'],
  ['failed', 'The music service did not complete the connection. Please try again.'],
]);

function ReturnNotice() {
  const params = useSearchParams();
  const message = connectionMessages.get(params.get('connection') ?? '');
  if (!message) return null;
  return (
    <div className="alert" role="alert">
      {message}
    </div>
  );
}
export function ConnectionReturnNotice() {
  return (
    <Suspense fallback={null}>
      <ReturnNotice />
    </Suspense>
  );
}
