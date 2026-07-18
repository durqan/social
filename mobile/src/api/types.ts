import type { User } from './domain';

export type {
  AuthResponse,
  ChangePasswordPayload,
  Comment,
  Conversation,
  Friendship,
  LoginPayload,
  Message,
  MessageAttachment,
  MessageLinkPreview,
  PaginatedMessages,
  PinnedMessage,
  Post,
  PostUser,
  RegisterPayload,
  SocialNotification,
  UpdateProfilePayload,
  User,
} from './domain';

function normalizeUserAvatarPosition(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 50;
}

function normalizeUserAvatarScale(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 1;
}

export function normalizeUser(user: User): User {
  return {
    ...user,
    createdAt: user.createdAt ?? user.created_at,
    updatedAt: user.updatedAt ?? user.updated_at,
    avatarUpdatedAt:
      user.avatarUpdatedAt ??
      user.avatar_updated_at ??
      user.updatedAt ??
      user.updated_at,
    isEmailVerified: user.isEmailVerified ?? user.is_email_verified ?? false,
    avatarPositionX:
      user.avatarPositionX ??
      normalizeUserAvatarPosition(user.avatar_position_x),
    avatarPositionY:
      user.avatarPositionY ??
      normalizeUserAvatarPosition(user.avatar_position_y),
    avatarScale:
      user.avatarScale ?? normalizeUserAvatarScale(user.avatar_scale),
  };
}
