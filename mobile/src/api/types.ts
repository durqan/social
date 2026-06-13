import type { User } from '@social/shared';
import {
  normalizeUserAvatarPosition,
  normalizeUserAvatarScale,
} from '@social/shared';

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
  PinnedMessage,
  Post,
  PostUser,
  RegisterPayload,
  SocialNotification,
  UpdateProfilePayload,
  User,
} from '@social/shared';

export function normalizeUser(user: User): User {
  return {
    ...user,
    createdAt: user.createdAt ?? user.created_at,
    isEmailVerified: user.isEmailVerified ?? user.is_email_verified ?? false,
    avatarPositionX:
      user.avatarPositionX ?? normalizeUserAvatarPosition(user.avatar_position_x),
    avatarPositionY:
      user.avatarPositionY ?? normalizeUserAvatarPosition(user.avatar_position_y),
    avatarScale: user.avatarScale ?? normalizeUserAvatarScale(user.avatar_scale),
  };
}
