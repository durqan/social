import { useEffect, useRef } from 'react';

import { useAppLifecycle } from '../context/AppLifecycleContext';

export function useAppResumeEffect(callback: () => void) {
  const { resumeCount } = useAppLifecycle();
  const callbackRef = useRef(callback);
  const lastResumeCountRef = useRef(resumeCount);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (resumeCount === lastResumeCountRef.current) {
      return;
    }

    lastResumeCountRef.current = resumeCount;
    callbackRef.current();
  }, [resumeCount]);
}
