/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_NOTIFICATIONS_URL?: string;
    readonly VITE_TURN_URLS?: string;
    readonly VITE_TURN_USERNAME?: string;
    readonly VITE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
