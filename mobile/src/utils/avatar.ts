import type { ImageStyle, StyleProp } from 'react-native';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
