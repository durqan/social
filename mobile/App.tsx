import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { userApi } from './src/api/services';
import { Loading } from './src/components/ui';
import { AuthScreen } from './src/screens/AuthScreen';
import { FeedScreen } from './src/screens/FeedScreen';
import { FriendsScreen } from './src/screens/FriendsScreen';
import { MessagesScreen } from './src/screens/MessagesScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { wsService } from './src/services/ws';
import type { Conversation, User } from './src/types';

type Tab = 'feed' | 'messages' | 'friends' | 'profile';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'feed', label: 'Лента' },
  { id: 'messages', label: 'Чаты' },
  { id: 'friends', label: 'Друзья' },
  { id: 'profile', label: 'Профиль' },
];

export default function App() {
  const [booting, setBooting] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('feed');
  const [requestedChat, setRequestedChat] = useState<Conversation | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        setCurrentUser(await userApi.profile());
      } catch {
        setCurrentUser(null);
      } finally {
        setBooting(false);
      }
    };

    bootstrap();
  }, []);

  useEffect(() => {
    if (!currentUser) {
      wsService.disconnect();
      return;
    }

    wsService.connect().catch(() => undefined);
    return () => wsService.disconnect();
  }, [currentUser]);

  const logout = async () => {
    setCurrentUser(null);
    setActiveTab('feed');
  };

  const renderTab = () => {
    if (!currentUser) return null;

    switch (activeTab) {
      case 'feed':
        return <FeedScreen />;
      case 'messages':
        return <MessagesScreen requestedChat={requestedChat} onRequestedChatHandled={() => setRequestedChat(null)} />;
      case 'friends':
        return <FriendsScreen onOpenChat={conversation => {
          setRequestedChat(conversation);
          setActiveTab('messages');
        }} />;
      case 'profile':
        return <ProfileScreen user={currentUser} onUserChange={setCurrentUser} onLogout={logout} />;
      default:
        return null;
    }
  };

  if (booting) {
    return <Loading />;
  }

  if (!currentUser) {
    return <AuthScreen onAuth={user => {
      setCurrentUser(user);
      Alert.alert('Готово', 'Вы вошли в мобильный клиент');
    }} />;
  }

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.logo}>Social</Text>
        <Text style={styles.user}>{currentUser.name || currentUser.email}</Text>
      </View>
      <View style={styles.body}>{renderTab()}</View>
      <View style={styles.tabs}>
        {tabs.map(tab => (
          <Pressable
            key={tab.id}
            onPress={() => setActiveTab(tab.id)}
            style={[styles.tab, activeTab === tab.id && styles.tabActive]}
          >
            <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: '#f4f5f7',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#ffffff',
  },
  logo: {
    color: '#0284c7',
    fontSize: 14,
    fontWeight: '900',
  },
  user: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  body: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#ffffff',
  },
  tab: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: '#e0f2fe',
  },
  tabText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '800',
  },
  tabTextActive: {
    color: '#0369a1',
  },
});
