'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Spinner } from '@/components/ui/spinner';

/** Landing route — routes to the right shell based on session state, never renders a shell itself. */
export default function Home() {
  const { status, principal } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login/staff');
    } else if (status === 'authenticated' && principal) {
      router.replace(principal.type === 'STAFF' ? '/dashboard' : '/parent');
    }
  }, [status, principal, router]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner />
    </div>
  );
}
