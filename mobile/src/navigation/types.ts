import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type VerificationStackParamList = {
  EmailVerificationNotice: undefined;
};

export type ChatStackParamList = {
  ChatList: undefined;
  Chat: {
    userId: number;
    name: string;
  };
};

export type MainTabParamList = {
  Home: undefined;
  Profile: undefined;
  Friends: undefined;
  Chats: NavigatorScreenParams<ChatStackParamList>;
  Settings: undefined;
};
