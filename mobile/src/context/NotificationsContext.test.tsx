import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockNotificationsApi = {
  getNotificationsPage: jest.fn(),
  markAsRead: jest.fn(),
  markAsSeen: jest.fn(),
  markMatchingAsRead: jest.fn(),
};
const mockChatSocket = {
  onMessage: jest.fn(),
};
const mockInitializePushNotifications = jest.fn();

jest.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { id: 1 } }),
}));
jest.mock('./AppLifecycleContext', () => ({
  useAppLifecycle: () => ({ resumeCount: 0 }),
}));
jest.mock('./UnreadContext', () => ({
  useUnread: () => ({
    refreshUnreadCount: jest.fn(),
    signalChatDataChanged: jest.fn(),
  }),
}));
jest.mock('../api/notifications', () => ({
  notificationsApi: mockNotificationsApi,
}));
jest.mock('../api/ws', () => ({
  chatSocket: mockChatSocket,
  WS_EVENTS: {
    CONVERSATION_READ: 'conversation_read',
  },
}));
jest.mock('../notifications/pushNotifications', () => ({
  initializePushNotifications: mockInitializePushNotifications,
}));
jest.mock('../notifications/pushEffects', () => ({
  applyPushNotificationEffects: jest.fn(),
  drainPendingPushEvents: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../api/http', () => ({
  getApiErrorMessage: jest.fn(() => 'Ошибка'),
}));
describe('NotificationsContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotificationsApi.getNotificationsPage.mockResolvedValue({
      notifications: [
        {
          id: 1,
          recipient_id: 1,
          actor_id: 2,
          type: 'friend_request',
          entity_id: 1,
          is_read: false,
          is_seen: false,
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 2,
          recipient_id: 1,
          actor_id: 3,
          type: 'friend_accepted',
          entity_id: 2,
          is_read: false,
          is_seen: true,
          created_at: '2026-01-02T00:00:00.000Z',
        },
      ],
      next_cursor: null,
      has_more: false,
      unseen_count: 1,
    });
    mockNotificationsApi.markAsSeen.mockResolvedValue(undefined);
    mockNotificationsApi.markMatchingAsRead.mockResolvedValue(undefined);
    mockChatSocket.onMessage.mockReturnValue(jest.fn());
    mockInitializePushNotifications.mockResolvedValue(jest.fn());
  });

  it('counts only unseen notifications for the badge and updates after mark-as-seen', async () => {
    const {
      NotificationsProvider,
      useNotifications,
    } = require('./NotificationsContext');
    let contextValue: ReturnType<typeof useNotifications> | undefined;
    function Consumer() {
      contextValue = useNotifications();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        <NotificationsProvider>
          <Consumer />
        </NotificationsProvider>,
      );
    });

    expect(contextValue?.unreadNotificationCount).toBe(1);

    await act(async () => {
      await contextValue?.markAsSeen([1]);
    });

    expect(mockNotificationsApi.markAsSeen).toHaveBeenCalledWith([1]);
    expect(contextValue?.unreadNotificationCount).toBe(0);
  });

  it('keeps badge state unchanged when mark-as-seen fails', async () => {
    mockNotificationsApi.markAsSeen.mockRejectedValueOnce(new Error('failed'));
    const {
      NotificationsProvider,
      useNotifications,
    } = require('./NotificationsContext');
    let contextValue: ReturnType<typeof useNotifications> | undefined;
    function Consumer() {
      contextValue = useNotifications();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        <NotificationsProvider>
          <Consumer />
        </NotificationsProvider>,
      );
    });

    await expect(contextValue?.markAsSeen([1])).rejects.toThrow('failed');
    expect(contextValue?.unreadNotificationCount).toBe(1);
  });

  it('marks matching conversation notifications read and seen', async () => {
    mockNotificationsApi.getNotificationsPage.mockResolvedValueOnce({
      notifications: [
        {
          id: 10,
          recipient_id: 1,
          actor_id: 2,
          type: 'message_received',
          entity_id: 100,
          conversation_id: 2,
          is_read: false,
          is_seen: false,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      next_cursor: null,
      has_more: false,
      unseen_count: 1,
    });
    const {
      NotificationsProvider,
      useNotifications,
    } = require('./NotificationsContext');
    let contextValue: ReturnType<typeof useNotifications> | undefined;
    function Consumer() {
      contextValue = useNotifications();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        <NotificationsProvider>
          <Consumer />
        </NotificationsProvider>,
      );
    });

    await act(async () => {
      await contextValue?.markMatchingAsRead({
        types: ['message_received'],
        conversation_id: 2,
      });
    });

    expect(contextValue?.notifications[0]).toMatchObject({
      is_read: true,
      is_seen: true,
    });
    expect(contextValue?.unreadNotificationCount).toBe(0);
  });

  it('counts duplicate message notifications as separate unseen badge items', async () => {
    mockNotificationsApi.getNotificationsPage.mockResolvedValueOnce({
      notifications: [
        {
          id: 10,
          recipient_id: 1,
          actor_id: 2,
          type: 'message_received',
          entity_id: 100,
          conversation_id: 2,
          is_read: false,
          is_seen: false,
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 11,
          recipient_id: 1,
          actor_id: 2,
          type: 'message_received',
          entity_id: 101,
          conversation_id: 2,
          is_read: false,
          is_seen: false,
          created_at: '2026-01-02T00:00:00.000Z',
        },
      ],
      next_cursor: null,
      has_more: false,
      unseen_count: 2,
    });
    const {
      NotificationsProvider,
      useNotifications,
    } = require('./NotificationsContext');
    let contextValue: ReturnType<typeof useNotifications> | undefined;
    function Consumer() {
      contextValue = useNotifications();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        <NotificationsProvider>
          <Consumer />
        </NotificationsProvider>,
      );
    });

    expect(contextValue?.unreadNotificationCount).toBe(2);

    await act(async () => {
      await contextValue?.markAsSeen([10, 11]);
    });

    expect(contextValue?.unreadNotificationCount).toBe(0);
  });
});

export {};
