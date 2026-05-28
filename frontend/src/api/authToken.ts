const authTokenKey = 'social.auth.token';

export const authTokenStore = {
    get(): string | null {
        try {
            return window.localStorage.getItem(authTokenKey);
        } catch {
            return null;
        }
    },

    set(token: string) {
        try {
            window.localStorage.setItem(authTokenKey, token);
        } catch {
            // Cookie auth still works when localStorage is unavailable.
        }
    },

    clear() {
        try {
            window.localStorage.removeItem(authTokenKey);
        } catch {
            // Ignore storage failures during logout.
        }
    },
};
