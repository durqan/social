export * from './media';

export function normalizeUserAvatarPosition(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 50;
}

export function normalizeUserAvatarScale(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 1;
}
