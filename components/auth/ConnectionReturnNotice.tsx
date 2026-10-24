'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
function ReturnNotice() {
  const params = useSearchParams();
  if (!params.has('error')) return null;
  return (
    <div className="alert" role="alert">
      Connection was not completed. Please connect your music service again.
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
