export function getSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error('WebCrypto is unavailable in this React Native runtime');
  }
  return subtle;
}
