import { describe, expect, it } from 'vitest';

import {
    dismissPushPrompt,
    isPushPromptDismissed,
    pushPromptDismissedForMs,
    pushPromptDismissedStorageKey,
} from './pushPromptDismissal.js';

describe('push prompt dismissal', () => {
    it('suppresses the prompt for seven days and allows it afterwards', () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => {
                values.set(key, value);
            },
        };
        const now = 1_000_000;

        dismissPushPrompt(storage, now);

        expect(values.get(pushPromptDismissedStorageKey)).toBe(String(now));
        expect(isPushPromptDismissed(storage, now + pushPromptDismissedForMs - 1)).toBe(true);
        expect(isPushPromptDismissed(storage, now + pushPromptDismissedForMs)).toBe(false);
    });
});
