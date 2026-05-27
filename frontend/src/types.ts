import type { Dispatch, SetStateAction } from 'react';

export interface User {
    id?: number;
    email: string;
    password?: string;
    name?: string;
    bio?: string;
    avatar?: string | null;
    createdAt?: string;
    isEmailVerified?: boolean;
    is_email_verified?: boolean;
    created_at?: string;
}

export interface Post {
    id: number;
    user_id: number;
    user: {
        id: number;
        name: string;
    };
    content: string;
    created_at: string;
    updated_at?: string;
    likes_count: number;
    comments_count: number;
    is_liked?: boolean;
}

export interface Comment {
    id: number;
    post_id: number;
    user_id: number;
    user: {
        id: number;
        name: string;
    };
    content: string;
    created_at: string;
    likes_count: number;
    is_liked: boolean;
}

export interface ProfileContextType {
    user: User;
    setUser: Dispatch<SetStateAction<User | null>>;
    isOwner?: boolean;
    currentUser?: User | null;
}

export interface PasswordChangeData {
    oldPassword: string;
    newPassword: string;
    confirmPassword: string;
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
    from: {
        id: number;
        name: string;
        email: string;
    };
    attachments?: MessageAttachment[];
}

export interface Conversation {
    user_id: number;
    name: string;
    last_message: string;
    last_message_at: string;
    unread_count: number;
}

export interface SocialNotification {
    id: number;
    recipient_id: number;
    actor_id: number;
    type: string;
    entity_id: number;
    is_read: boolean;
    created_at: string;
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
