export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radius = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  pill: 999,
} as const;

export const touchTarget = {
  sm: 44,
  md: 48,
  lg: 56,
} as const;

const fontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  heavy: '800' as const,
  black: '900' as const,
} as const;

export type TextSizeId = 'compact' | 'standard' | 'large';

export const textSizeOrder: TextSizeId[] = ['compact', 'standard', 'large'];

export const textSizeOptions: Record<
  TextSizeId,
  { label: string; description: string; scale: number }
> = {
  compact: {
    label: 'Компактно',
    description: 'Больше контента на экране',
    scale: 0.94,
  },
  standard: {
    label: 'Обычно',
    description: 'Баланс размера и плотности',
    scale: 1,
  },
  large: {
    label: 'Крупно',
    description: 'Удобнее для чтения',
    scale: 1.08,
  },
};

const baseTypography = {
  caption: { fontSize: 12, lineHeight: 16, fontWeight: fontWeights.regular },
  body: { fontSize: 14, lineHeight: 20, fontWeight: fontWeights.regular },
  subtitle: { fontSize: 16, lineHeight: 22, fontWeight: fontWeights.semibold },
  title: { fontSize: 20, lineHeight: 26, fontWeight: fontWeights.semibold },
  headline: { fontSize: 27, lineHeight: 33, fontWeight: fontWeights.heavy },
  tiny: { fontSize: 10, lineHeight: 13, fontWeight: fontWeights.regular },
} as const;

function scaleValue(value: number, scale: number) {
  return Math.max(10, Math.round(value * scale));
}

function scaleText<T extends { fontSize: number; lineHeight: number }>(
  value: T,
  scale: number,
) {
  return {
    ...value,
    fontSize: scaleValue(value.fontSize, scale),
    lineHeight: scaleValue(value.lineHeight, scale),
  };
}

function createTypography(scale = 1) {
  const caption = scaleText(baseTypography.caption, scale);
  const body = scaleText(baseTypography.body, scale);
  const subtitle = scaleText(baseTypography.subtitle, scale);
  const title = scaleText(baseTypography.title, scale);
  const headline = scaleText(baseTypography.headline, scale);
  const tiny = scaleText(baseTypography.tiny, scale);

  return {
    caption,
    body,
    subtitle,
    title,
    headline,
    tiny,
    // Backward-compatible aliases. Старые экраны можно переводить постепенно.
    h1: headline,
    h2: title,
    h3: subtitle,
  };
}

export const typography = createTypography();

export function applyTypographyScale(scale: number) {
  Object.assign(typography, createTypography(scale));
}

export function isTextSizeId(
  value: string | null | undefined,
): value is TextSizeId {
  return Boolean(
    value && Object.prototype.hasOwnProperty.call(textSizeOptions, value),
  );
}

export const elevation = {
  none: {
    shadowOpacity: 0,
    elevation: 0,
  },
  card: {
    shadowOpacity: 0.1,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 2,
  },
  raised: {
    shadowOpacity: 0.14,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 4,
  },
  bar: {
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -10 },
    elevation: 8,
  },
} as const;
