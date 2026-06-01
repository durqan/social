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
  message_id?: number;
  file_url: string;
  file_type: 'image';
  width?: number;
  height?: number;
  size: number;
}

export interface Message {
  id: number;
  from_id: number;
  to_id: number;
  content: string;
  created_at: string;
  is_read: boolean;
  from?: {
    id: number;
    name: string;
    email: string;
  };
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
