export const pushPromptDismissedStorageKey = 'social.web-push-prompt-dismissed-at';
export const pushPromptDismissedForMs = 7 * 24 * 60 * 60 * 1000;

export function isPushPromptDismissed(storage: Pick<Storage, 'getItem'>, now = Date.now()) {
    const dismissedAt = Number(storage.getItem(pushPromptDismissedStorageKey));
    return Number.isFinite(dismissedAt) && now - dismissedAt < pushPromptDismissedForMs;
}

export function dismissPushPrompt(storage: Pick<Storage, 'setItem'>, now = Date.now()) {
    storage.setItem(pushPromptDismissedStorageKey, String(now));
}
