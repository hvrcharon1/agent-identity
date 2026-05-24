import { useState, useCallback } from 'react';
import type { IdentityType } from '@/lib/types';

export function useIdentity(initial: IdentityType = 'user-delegated') {
  const [identityType, setIdentityType] = useState<IdentityType>(initial);

  const select = useCallback((type: IdentityType) => {
    setIdentityType(type);
  }, []);

  return { identityType, select };
}
