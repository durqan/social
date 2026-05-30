export function logDev(...args: unknown[]) {
  if (__DEV__) {
    console.log(...args);
  }
}

export function warnDev(...args: unknown[]) {
  if (__DEV__) {
    console.warn(...args);
  }
}
