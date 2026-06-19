import { useEffect } from 'react';

import { runPostAuthBootstrap } from '../bootstrap/postAuthBootstrap';
import { useAppLifecycle } from '../context/AppLifecycleContext';
import { useAuth } from '../context/AuthContext';

export function PostAuthBootstrapManager() {
  const { user } = useAuth();
  const { networkConnected, resumeCount } = useAppLifecycle();

  useEffect(() => {
    if (!user?.id || !networkConnected) {
      return;
    }
    runPostAuthBootstrap(user.id).catch(() => undefined);
  }, [networkConnected, resumeCount, user?.id]);

  return null;
}
