'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// The open job lives in the URL (?job=<id>) so it can be linked and survives reloads.
export function useOpenJob() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback((id: string | null, path?: string) => {
    const base = path || pathname;
    router.push(id ? base + '?job=' + id : base, { scroll: false });
  }, [router, pathname]);
}
