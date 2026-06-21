import type { ImageStyle, StyleProp } from 'react-native';

import { assetURL } from '../config/env';

type AvatarSource = {
  avatar?: string | null;
  avatarUpdatedAt?: string | null;
  avatar_updated_at?: string | null;
  updatedAt?: string | null;
  updated_at?: string | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function appendQueryParam(url: string, key: string, value: string) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(
    value,
  )}`;
}

export function buildAvatarUrl(source?: AvatarSource | null) {
  if (!source?.avatar) {
    return null;
  }

  const version =
    source.avatarUpdatedAt ||
    source.avatar_updated_at ||
    source.updatedAt ||
    source.updated_at;
  const url = assetURL(source.avatar);

  return version ? appendQueryParam(url, 'v', version) : url;
}

export function avatarImageStyle({
  size,
  positionX = 50,
  positionY = 50,
  scale = 1,
}: {
  size: number;
  positionX?: number;
  positionY?: number;
  scale?: number;
}): StyleProp<ImageStyle> {
  const safeScale = clamp(Number(scale) || 1, 1, 3);
  const safeX = clamp(Number(positionX) || 50, 0, 100);
  const safeY = clamp(Number(positionY) || 50, 0, 100);
  const scaledSize = size * safeScale;

  return {
    position: 'absolute',
    width: scaledSize,
    height: scaledSize,
    left: (size - scaledSize) * (safeX / 100),
    top: (size - scaledSize) * (safeY / 100),
  };
}
