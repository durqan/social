import type { StatusBarStyle } from "react-native";

export type ThemeId =
  | "aurora-bubble"
  | "cosmic-indigo"
  | "warm-linen"
  | "neon-social"
  | "mono-premium";

export type ThemeColors = {
  id: ThemeId;
  name: string;
  description: string;
  isDark: boolean;
  statusBarStyle: StatusBarStyle;
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  card: string;
  cardMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textPrimary: string;
  textMuted: string;
  textSoft: string;
  muted: string;
  soft: string;
  white: string;
  input: string;
  inputFocus: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  accentBorder: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  overlay: string;
  overlaySoft: string;
  pressed: string;
  selected: string;
  messageOwnBg: string;
  messageOwnBorder: string;
  messageOwnText: string;
  messageOtherBg: string;
  messageOtherBorder: string;
  messageOtherText: string;
  profileCover: string;
  shadow: string;
  gradient: [string, string];
};

export const themeOrder: ThemeId[] = [
  "aurora-bubble",
  "cosmic-indigo",
  "warm-linen",
  "neon-social",
  "mono-premium",
];

export const themes: Record<ThemeId, ThemeColors> = {
  "aurora-bubble": {
    id: "aurora-bubble",
    name: "Clean Glass",
    description:
      "Светлая нейтральная glass-тема: белый, молочный blue-gray, мягкий контраст",
    isDark: false,
    statusBarStyle: "dark-content",

    background: "#EEF2F7",
    surface: "#F8FAFC",
    surfaceElevated: "#FFFFFF",
    surfaceMuted: "#E7ECF2",
    card: "#FFFFFF",
    cardMuted: "#F1F5F9",

    border: "rgba(15, 23, 42, 0.11)",
    borderStrong: "rgba(15, 23, 42, 0.20)",

    text: "#172033",
    textPrimary: "#0F172A",
    textMuted: "#64748B",
    textSoft: "#94A3B8",
    muted: "#64748B",
    soft: "#94A3B8",
    white: "#FFFFFF",

    input: "#FFFFFF",
    inputFocus: "#FFFFFF",

    accent: "#547E94",
    accentStrong: "#315F77",
    accentSoft: "rgba(84, 126, 148, 0.12)",
    accentBorder: "rgba(84, 126, 148, 0.28)",

    success: "#12B76A",
    successSoft: "rgba(18, 183, 106, 0.10)",
    warning: "#F79009",
    warningSoft: "rgba(247, 144, 9, 0.11)",
    danger: "#F04438",
    dangerSoft: "rgba(240, 68, 56, 0.09)",

    overlay: "rgba(15, 23, 42, 0.38)",
    overlaySoft: "rgba(15, 23, 42, 0.18)",
    pressed: "rgba(15, 23, 42, 0.04)",
    selected: "rgba(111, 152, 173, 0.09)",

    messageOwnBg: "#EAF2F6",
    messageOwnBorder: "rgba(111, 152, 173, 0.22)",
    messageOwnText: "#172033",

    messageOtherBg: "#FFFFFF",
    messageOtherBorder: "rgba(15, 23, 42, 0.07)",
    messageOtherText: "#172033",

    profileCover: "#DCE7EF",
    shadow: "rgba(15, 23, 42, 0.12)",
    gradient: ["#D0E0EA", "#FFFFFF"],
  },

  "cosmic-indigo": {
    id: "cosmic-indigo",
    name: "Cosmic Indigo",
    description:
      "Тёмная космическая тема: глубокий индиго, кристалл, холодный неон",
    isDark: true,
    statusBarStyle: "light-content",

    background: "#050816",
    surface: "#0D1024",
    surfaceElevated: "#111633",
    surfaceMuted: "#151936",
    card: "#0B0F22",
    cardMuted: "#141832",

    border: "rgba(122, 135, 255, 0.17)",
    borderStrong: "rgba(122, 135, 255, 0.40)",

    text: "#F4F6FF",
    textPrimary: "#FFFFFF",
    textMuted: "#AAB1D6",
    textSoft: "#7078A4",
    muted: "#AAB1D6",
    soft: "#7078A4",
    white: "#FFFFFF",

    input: "#0A0D1E",
    inputFocus: "#141936",

    accent: "#6D7CFF",
    accentStrong: "#A78BFA",
    accentSoft: "rgba(109, 124, 255, 0.17)",
    accentBorder: "rgba(109, 124, 255, 0.42)",

    success: "#34D399",
    successSoft: "rgba(52, 211, 153, 0.14)",
    warning: "#FBBF24",
    warningSoft: "rgba(251, 191, 36, 0.13)",
    danger: "#FB7185",
    dangerSoft: "rgba(251, 113, 133, 0.14)",

    overlay: "rgba(2, 4, 14, 0.84)",
    overlaySoft: "rgba(2, 4, 14, 0.62)",
    pressed: "rgba(109, 124, 255, 0.11)",
    selected: "rgba(109, 124, 255, 0.18)",

    messageOwnBg: "#3F3ACB",
    messageOwnBorder: "rgba(140, 150, 255, 0.34)",
    messageOwnText: "#FFFFFF",

    messageOtherBg: "#171B36",
    messageOtherBorder: "rgba(255, 255, 255, 0.08)",
    messageOtherText: "#F4F6FF",

    profileCover: "#252B74",
    shadow: "rgba(0, 0, 0, 0.68)",
    gradient: ["#3F3ACB", "#A78BFA"],
  },

  "warm-linen": {
    id: "warm-linen",
    name: "Warm Linen",
    description: "Тёплая premium-тема: кремовый лён, терракота, мягкий свет",
    isDark: false,
    statusBarStyle: "dark-content",

    background: "#FBF1E6",
    surface: "#FFF9F1",
    surfaceElevated: "#FFFFFF",
    surfaceMuted: "#F7E8D8",
    card: "#FFFCF7",
    cardMuted: "#F9EFE2",

    border: "rgba(177, 108, 63, 0.15)",
    borderStrong: "rgba(194, 112, 61, 0.32)",

    text: "#3A2B22",
    textPrimary: "#2C211B",
    textMuted: "#8B7461",
    textSoft: "#B9A590",
    muted: "#8B7461",
    soft: "#B9A590",
    white: "#FFFFFF",

    input: "#FFF7EE",
    inputFocus: "#FFFFFF",

    accent: "#CF7A45",
    accentStrong: "#DF8758",
    accentSoft: "rgba(207, 122, 69, 0.13)",
    accentBorder: "rgba(207, 122, 69, 0.30)",

    success: "#4D7C0F",
    successSoft: "rgba(77, 124, 15, 0.12)",
    warning: "#B45309",
    warningSoft: "rgba(180, 83, 9, 0.13)",
    danger: "#C0392B",
    dangerSoft: "rgba(192, 57, 43, 0.11)",

    overlay: "rgba(58, 44, 34, 0.50)",
    overlaySoft: "rgba(58, 44, 34, 0.31)",
    pressed: "rgba(207, 122, 69, 0.08)",
    selected: "rgba(207, 122, 69, 0.13)",

    messageOwnBg: "#F3D6BA",
    messageOwnBorder: "rgba(207, 122, 69, 0.27)",
    messageOwnText: "#3A2B22",

    messageOtherBg: "#FFFCF7",
    messageOtherBorder: "rgba(177, 108, 63, 0.13)",
    messageOtherText: "#3A2B22",

    profileCover: "#E9C9A3",
    shadow: "rgba(154, 98, 53, 0.17)",
    gradient: ["#DF8758", "#CF7A45"],
  },

  "neon-social": {
    id: "neon-social",
    name: "Neon Social",
    description: "Яркая social-тема: тёмный космос, фиолетовый, розовый, синий",
    isDark: true,
    statusBarStyle: "light-content",

    background: "#070816",
    surface: "#11142A",
    surfaceElevated: "#171B38",
    surfaceMuted: "#1A1D3A",
    card: "#0F1226",
    cardMuted: "#181B36",

    border: "rgba(183, 116, 255, 0.17)",
    borderStrong: "rgba(236, 72, 153, 0.40)",

    text: "#FAF7FF",
    textPrimary: "#FFFFFF",
    textMuted: "#C3B6E3",
    textSoft: "#887BA9",
    muted: "#C3B6E3",
    soft: "#887BA9",
    white: "#FFFFFF",

    input: "#101326",
    inputFocus: "#1A1D38",

    accent: "#8B5CF6",
    accentStrong: "#EC4899",
    accentSoft: "rgba(139, 92, 246, 0.18)",
    accentBorder: "rgba(139, 92, 246, 0.42)",

    success: "#27D58A",
    successSoft: "rgba(39, 213, 138, 0.14)",
    warning: "#FBBF24",
    warningSoft: "rgba(251, 191, 36, 0.13)",
    danger: "#FB7185",
    dangerSoft: "rgba(251, 113, 133, 0.14)",

    overlay: "rgba(5, 3, 15, 0.86)",
    overlaySoft: "rgba(5, 3, 15, 0.62)",
    pressed: "rgba(139, 92, 246, 0.12)",
    selected: "rgba(139, 92, 246, 0.19)",

    messageOwnBg: "#6D35E8",
    messageOwnBorder: "rgba(236, 72, 153, 0.34)",
    messageOwnText: "#FFFFFF",

    messageOtherBg: "#1A1D36",
    messageOtherBorder: "rgba(255, 255, 255, 0.08)",
    messageOtherText: "#FAF7FF",

    profileCover: "#361468",
    shadow: "rgba(0, 0, 0, 0.70)",
    gradient: ["#8B5CF6", "#EC4899"],
  },

  "mono-premium": {
    id: "mono-premium",
    name: "Mono Premium",
    description:
      "Премиальная монохромная тема: чёрный, графит, серебро, металл",
    isDark: true,
    statusBarStyle: "light-content",

    background: "#060708",
    surface: "#101214",
    surfaceElevated: "#171A1E",
    surfaceMuted: "#181B1F",
    card: "#111316",
    cardMuted: "#1A1D21",

    border: "rgba(255, 255, 255, 0.09)",
    borderStrong: "rgba(255, 255, 255, 0.23)",

    text: "#F4F4F5",
    textPrimary: "#FFFFFF",
    textMuted: "#A8ADB5",
    textSoft: "#707781",
    muted: "#A8ADB5",
    soft: "#707781",
    white: "#FFFFFF",

    input: "#0F1114",
    inputFocus: "#181B20",

    accent: "#D9DDE3",
    accentStrong: "#FFFFFF",
    accentSoft: "rgba(255, 255, 255, 0.10)",
    accentBorder: "rgba(255, 255, 255, 0.25)",

    success: "#34D399",
    successSoft: "rgba(52, 211, 153, 0.12)",
    warning: "#EAB308",
    warningSoft: "rgba(234, 179, 8, 0.12)",
    danger: "#FB7185",
    dangerSoft: "rgba(251, 113, 133, 0.13)",

    overlay: "rgba(0, 0, 0, 0.80)",
    overlaySoft: "rgba(0, 0, 0, 0.56)",
    pressed: "rgba(255, 255, 255, 0.08)",
    selected: "rgba(255, 255, 255, 0.12)",

    messageOwnBg: "#262B32",
    messageOwnBorder: "rgba(255, 255, 255, 0.16)",
    messageOwnText: "#FFFFFF",

    messageOtherBg: "#181B20",
    messageOtherBorder: "rgba(255, 255, 255, 0.08)",
    messageOtherText: "#F4F4F5",

    profileCover: "#262A30",
    shadow: "rgba(0, 0, 0, 0.76)",
    gradient: ["#8A8F98", "#F5F5F5"],
  },
};

export const defaultThemeId: ThemeId = "cosmic-indigo";

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return Boolean(value && Object.prototype.hasOwnProperty.call(themes, value));
}
