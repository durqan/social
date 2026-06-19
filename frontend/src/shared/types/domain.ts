import type { Dispatch, SetStateAction } from 'react';

import type { User } from '@social/shared';

export type {
    AuthResponse,
    ChangePasswordPayload,
    Comment,
    Conversation,
    Friendship,
    LoginPayload,
    Message,
    MessageAttachment,
    MessageUser,
    PaginatedMessages,
    PasswordChangeData,
    PinnedMessage,
    ReactionSummary,
    Post,
    PostUser,
    RegisterPayload,
    SocialNotification,
    UpdateProfilePayload,
    User,
} from '@social/shared';

export interface ProfileContextType {
    user: User;
    setUser: Dispatch<SetStateAction<User | null>>;
    isOwner?: boolean;
    currentUser?: User | null;
}
