import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../components/AppButton';
import { ErrorBanner, Notice } from '../../components/Feedback';
import { Screen } from '../../components/Screen';
import { getApiErrorMessage } from '../../api/http';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { formatDateTime } from '../../utils/format';

export default function ProfileScreen() {
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    setLoading(true);
    setError(null);
    try {
      await refreshUser();
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{user?.name || 'Без имени'}</Text>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      <ErrorBanner message={error} />

      <View style={styles.infoCard}>
        <InfoRow label="ID" value={user?.id ? String(user.id) : 'Нет данных'} />
        <InfoRow label="Bio" value={user?.bio || 'Не заполнено'} />
        <InfoRow
          label="Создан"
          value={formatDateTime(user?.createdAt ?? user?.created_at)}
        />
        <InfoRow
          label="Email"
          value={user?.isEmailVerified ? 'Подтвержден' : 'Не подтвержден'}
        />
      </View>

      <AppButton
        title="Обновить профиль"
        variant="secondary"
        loading={loading}
        onPress={handleRefresh}
      />

      <Notice
        title="Редактирование профиля"
        text="Формы редактирования профиля, аватара и пароля оставлены TODO для следующего этапа."
      />
    </Screen>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || 'Нет данных'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 39, 0.06)',
    borderRadius: 14,
    backgroundColor: colors.surface,
    padding: 20,
    gap: 8,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
  },
  name: {
    color: colors.text,
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '800',
  },
  email: {
    color: colors.muted,
    fontSize: 15,
  },
  infoCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  infoRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    padding: 14,
    gap: 4,
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  infoValue: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
});
