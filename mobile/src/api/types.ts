export interface User {
  id?: number;
  email: string;
  name?: string;
  age?: number;
  bio?: string;
  avatar?: string | null;
  createdAt?: string;
  created_at?: string;
  isEmailVerified?: boolean;
  is_email_verified?: boolean;
}

export interface AuthResponse {
  message: string;
  user: User;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  website?: string;
}

export interface Friendship {
  id: number;
  user_id: number;
  friend_id: number;
  status: 'pending' | 'accepted' | 'rejected' | 'blocked';
  created_at: string;
  user?: User;
  friend?: User;
}

export interface Conversation {
  user_id: number;
  name: string;
  last_message: string;
  last_message_at: string;
  last_sender_id: number;
  last_sender_name: string;
  last_is_mine: boolean;
  last_read: boolean;
  unread_count: number;
}

export interface MessageAttachment {
  id?: number;
  attachment_id?: string;
  message_id?: number;
  file_url: string;
  file_type: 'image' | 'voice' | 'video_note';
  width?: number;
  height?: number;
  duration?: number;
  duration_seconds?: number;
  size: number;
  created_at?: string;
}

export interface MessageUser {
  id: number;
  name: string;
  email: string;
  age?: number;
  bio?: string;
  avatar?: string | null;
  avatar_position_x?: number;
  avatar_position_y?: number;
  avatar_scale?: number;
  is_email_verified?: boolean;
  created_at?: string;
}

export interface Message {
  id: number;
  from_id: number;
  to_id: number;
  content: string;
  created_at: string;
  updated_at?: string;
  is_read: boolean;
  reply_to_message_id?: number | null;
  forwarded_from_message_id?: number | null;
  forwarded_from_user_id?: number | null;
  from?: MessageUser;
  to?: MessageUser;
  reply_to_message?: Message | null;
  forwarded_from_message?: Message | null;
  forwarded_from_user?: MessageUser | null;
  attachments?: MessageAttachment[];
}

export interface PaginatedMessages {
  messages: Message[];
  has_more: boolean;
}

export interface UpdateProfilePayload {
  name?: string;
  email?: string;
  age?: number;
  bio?: string;
}

export function normalizeUser(user: User): User {
  return {
    ...user,
    createdAt: user.createdAt ?? user.created_at,
    isEmailVerified: user.isEmailVerified ?? user.is_email_verified ?? false,
  };
}
