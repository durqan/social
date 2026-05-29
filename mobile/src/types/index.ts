export type User = {
  id?: number;
  email: string;
  name?: string;
  bio?: string;
  age?: number;
  avatar?: string | null;
  created_at?: string;
  createdAt?: string;
  is_email_verified?: boolean;
  isEmailVerified?: boolean;
};

export type Post = {
  id: number;
  user_id: number;
  user: User;
  content: string;
  created_at: string;
  likes_count: number;
  comments_count: number;
  is_liked?: boolean;
};

export type Comment = {
  id: number;
  post_id: number;
  user_id: number;
  user: User;
  content: string;
  created_at: string;
  likes_count: number;
  is_liked: boolean;
};

export type Friendship = {
  id: number;
  user_id: number;
  friend_id: number;
  status: 'pending' | 'accepted' | 'blocked' | 'rejected';
  created_at: string;
  user?: User;
  friend?: User;
};

export type Conversation = {
  user_id: number;
  name: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
};

export type MessageAttachment = {
  id?: number;
  message_id?: number;
  file_url: string;
  file_type: 'image';
  width?: number;
  height?: number;
  size: number;
};

export type Message = {
  id: number;
  from_id: number;
  to_id: number;
  content: string;
  created_at: string;
  is_read: boolean;
  from: User;
  attachments?: MessageAttachment[];
};

export type AuthResponse = {
  message: string;
  user: User;
};

export interface BaseWsEvent<T extends string, P> {
  type: T;
  payload: P;
}

export type MessageNewEvent = BaseWsEvent<'message:new', Message>;

export type WsEvent = MessageNewEvent;
