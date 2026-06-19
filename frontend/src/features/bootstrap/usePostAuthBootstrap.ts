import { useSyncExternalStore } from 'react';

import {
    getPostAuthBootstrapState,
    subscribePostAuthBootstrap,
} from "@/features/bootstrap/postAuthBootstrap.js";

export function usePostAuthBootstrap() {
    return useSyncExternalStore(
        subscribePostAuthBootstrap,
        getPostAuthBootstrapState,
        getPostAuthBootstrapState,
    );
}
