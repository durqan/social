export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const typography = {
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '900' as const },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: '800' as const },
  h3: { fontSize: 18, lineHeight: 24, fontWeight: '800' as const },
  body: { fontSize: 15, lineHeight: 22 },
  caption: { fontSize: 13, lineHeight: 18 },
  tiny: { fontSize: 11, lineHeight: 14 },
} as const;
