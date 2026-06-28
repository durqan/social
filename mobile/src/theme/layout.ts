export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
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
  h1: { fontSize: 27, lineHeight: 33, fontWeight: '800' as const },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: '800' as const },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '700' as const },
  body: { fontSize: 14, lineHeight: 20 },
  caption: { fontSize: 12, lineHeight: 16 },
  tiny: { fontSize: 10, lineHeight: 13 },
} as const;

function scaleValue(value: number, scale: number) {
  return Math.max(10, Math.round(value * scale));
}

export function createTypography(scale = 1) {
  return {
    h1: {
      ...baseTypography.h1,
      fontSize: scaleValue(baseTypography.h1.fontSize, scale),
      lineHeight: scaleValue(baseTypography.h1.lineHeight, scale),
    },
    h2: {
      ...baseTypography.h2,
      fontSize: scaleValue(baseTypography.h2.fontSize, scale),
      lineHeight: scaleValue(baseTypography.h2.lineHeight, scale),
    },
    h3: {
      ...baseTypography.h3,
      fontSize: scaleValue(baseTypography.h3.fontSize, scale),
      lineHeight: scaleValue(baseTypography.h3.lineHeight, scale),
    },
    body: {
      ...baseTypography.body,
      fontSize: scaleValue(baseTypography.body.fontSize, scale),
      lineHeight: scaleValue(baseTypography.body.lineHeight, scale),
    },
    caption: {
      ...baseTypography.caption,
      fontSize: scaleValue(baseTypography.caption.fontSize, scale),
      lineHeight: scaleValue(baseTypography.caption.lineHeight, scale),
    },
    tiny: {
      ...baseTypography.tiny,
      fontSize: scaleValue(baseTypography.tiny.fontSize, scale),
      lineHeight: scaleValue(baseTypography.tiny.lineHeight, scale),
    },
  };
}

export type AppTypography = ReturnType<typeof createTypography>;

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
  bar: {
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -10 },
    elevation: 8,
  },
} as const;
