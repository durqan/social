self.addEventListener('push', event => {
    let payload = {
        title: 'Новое уведомление',
        body: 'Откройте приложение, чтобы посмотреть',
        url: '/',
    };

    if (event.data) {
        try {
            payload = { ...payload, ...event.data.json() };
        } catch {
            payload = { ...payload, body: event.data.text() };
        }
    }

    let tag = payload.tag;
    if (!tag) {
        switch (payload.type) {
            case 'message_received':
                tag = payload.conversation_id ? `message:${payload.conversation_id}` : 'messages';
                break;
            case 'friend_request':
            case 'friend_accepted':
                tag = 'friends';
                break;
            case 'post_liked':
            case 'comment_created':
                tag = 'activity';
                break;
            case 'incoming_call':
                tag = payload.call_id ? `call-${payload.call_id}` : 'call';
                break;
            default:
                tag = `notification-${payload.notification_id || Date.now()}`;
        }
    }

    if (payload.type === 'notification_sync' && payload.sync_action === 'message_read') {
        const syncTag = payload.conversation_id ? `message:${payload.conversation_id}` : tag;
        event.waitUntil(closeNotificationsByTag(syncTag));
        return;
    }

    const isCall = payload.type === 'incoming_call' || payload.kind === 'call';

    const notificationOptions = {
        body: payload.body,
        icon: '/pwa-icon-192.png',
        badge: '/pwa-icon-192.png',
        tag: tag,
        data: {
            url: payload.url || '/',
            notification_id: payload.notification_id,
            type: payload.type,
            call_id: payload.call_id,
            call_type: payload.call_type,
            caller_id: payload.actor_id || payload.caller_id,
            conversation_id: payload.conversation_id,
            ts: payload.ts || Date.now(),
        },
        renotify: true,
    };

    // For incoming calls we want the notification to stay on screen until the user interacts
    // (especially important on desktop). requireInteraction is supported in most modern browsers
    // for web push (with some platform limitations on mobile).
    if (isCall) {
        notificationOptions.requireInteraction = true;
        // Optional: vibrate pattern for calls if the platform supports it via actions or silent flags.
        // We keep it simple here – the OS will usually apply call-like treatment for persistent notifs.
    }

    event.waitUntil(self.registration.showNotification(payload.title, notificationOptions));
});

function closeNotificationsByTag(tag) {
    if (!tag || !self.registration.getNotifications) {
        return Promise.resolve();
    }

    return self.registration.getNotifications({ tag }).then(notifications => {
        notifications.forEach(notification => notification.close());
    });
}

self.addEventListener('message', event => {
    const data = event.data || {};
    if (data.type === 'notification_sync' && data.sync_action === 'message_read') {
        const tag = data.conversation_id ? `message:${data.conversation_id}` : data.tag;
        event.waitUntil(closeNotificationsByTag(tag));
    }
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    const data = event.notification.data || {};
    const rawURL = data.url || '/';
    const notificationURL = new URL(rawURL, self.location.origin).href;

    const isCallNotification = data.type === 'incoming_call' ||
        (data.call_id && rawURL.includes('incomingCall')) ||
        event.notification.tag?.startsWith('call-');

    event.waitUntil(
        self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
        }).then(async (clientList) => {
            // If we have open windows, prefer focusing one and navigating it to the call/chat.
            // We also postMessage so that a foreground app can react (e.g. highlight the chat,
            // or decide to auto-show CallOverlay if the WS offer is still fresh).
            if (clientList.length > 0) {
                // Try to find a client that is already on a chat or can be navigated.
                // We bias towards focusing any visible client.
                const sortedClients = [...clientList].sort((a, b) => {
                    if (a.visibilityState === 'visible' && b.visibilityState !== 'visible') return -1;
                    if (b.visibilityState === 'visible' && a.visibilityState !== 'visible') return 1;
                    return 0;
                });

                const targetClient = sortedClients[0];

                if ('focus' in targetClient) {
                    const focused = await targetClient.focus();

                    if ('navigate' in focused && focused.url !== notificationURL) {
                        try {
                            await focused.navigate(notificationURL);
                        } catch {
                            // Navigation may be blocked in some cases; fall back to message.
                        }
                    }

                    // Notify the page about the call notification click.
                    // The app can use this to open the right chat or prepare the call UI.
                    if ('postMessage' in focused) {
                        focused.postMessage({
                            type: 'notification-click',
                            kind: isCallNotification ? 'incoming_call' : 'notification',
                            callId: data.call_id,
                            callType: data.call_type,
                            callerId: data.caller_id || data.actor_id,
                            conversationId: data.conversation_id,
                            url: notificationURL,
                            timestamp: data.ts,
                        });
                    }

                    return focused;
                }
            }

            // No existing clients – open a new window at the deep link (the chat of the caller).
            // The app will receive the ?incomingCall=1&callId=... query params and can decide
            // what to do (open chat + let normal WS call:offer flow show the overlay if fresh).
            return self.clients.openWindow(notificationURL);
        })
    );
});
