/** Shared palette and spacing. Matches the web app's Tailwind theme. */

export const colors = {
  cream: "#faf7f2",
  surface: "#ffffff",
  ink: "#1f2421",
  inkMuted: "#1f2421a6",
  inkFaint: "#1f24216b",
  border: "#1f24211f",

  moss50: "#f1f6f2",
  moss100: "#dcebe0",
  moss500: "#4a7c59",
  moss600: "#3d6849",
  moss700: "#2f5138",

  clay100: "#fbe9e0",
  clay500: "#c96f4a",
  clay600: "#ad5b39",

  amber100: "#fdf0d5",
  amber500: "#d99b32",
  amber600: "#b87f22",
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
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

/** Minimum comfortable tap target. */
export const TAP_TARGET = 44;
