import { useCallback, useRef, useState } from 'react';

export function useRefState<T>(initialValue: T) {
    const [state, setState] = useState(initialValue);
    const ref = useRef(initialValue);

    const setRefState = useCallback((nextValue: T) => {
        ref.current = nextValue;
        setState(nextValue);
    }, []);

    return [state, ref, setRefState] as const;
}
