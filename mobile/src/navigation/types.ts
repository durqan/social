import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword:
    | {
        token?: string;
      }
    | undefined;
  VerifyEmail: {
    token: string;
  };
};

export type ChatStackParamList = {
  ChatList: undefined;
  Chat: {
    userId: number;
    name: string;
    incomingCall?: boolean;
    callId?: string;
  };
};

export type MainTabParamList = {
  Home: undefined;
  Profile: undefined;
  Friends: undefined;
  Chats: NavigatorScreenParams<ChatStackParamList>;
  Notifications: undefined;
  Settings: undefined;
};

export type MainStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  UserProfile: {
    userId: number;
    name?: string;
  };
  UserSearch: undefined;
  VerifyEmail: {
    token: string;
  };
  ResetPassword:
    | {
        token?: string;
      }
    | undefined;
};
