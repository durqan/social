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

    event.waitUntil(self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/pwa-icon-192.png',
        badge: '/pwa-icon-192.png',
        tag: payload.tag || `notification-${payload.notification_id || Date.now()}`,
        data: {
            url: payload.url || '/',
            notification_id: payload.notification_id,
        },
        renotify: true,
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    const notificationURL = new URL(event.notification.data?.url || '/', self.location.origin).href;

    event.waitUntil(self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
    }).then(clientList => {
        for (const client of clientList) {
            if ('focus' in client) {
                return client.focus().then(focusedClient => {
                    if ('navigate' in focusedClient) {
                        return focusedClient.navigate(notificationURL);
                    }

                    return focusedClient;
                });
            }
        }

        return self.clients.openWindow(notificationURL);
    }));
});
