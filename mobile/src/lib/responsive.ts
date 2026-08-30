import { useWindowDimensions } from "react-native";

/**
 * Phone vs tablet layout.
 *
 * Driven by `useWindowDimensions`, not a one-off `Dimensions.get`, so the
 * layout follows a tablet being rotated or an iPad split-view being resized
 * rather than being frozen at launch orientation.
 */

export const TABLET_BREAKPOINT = 768;
export const WIDE_BREAKPOINT = 1024;

export interface Responsive {
  width: number;
  /** ≥768pt: two-column grids, roomier spacing. */
  isTablet: boolean;
  /** ≥1024pt: a landscape tablet, wide enough for three columns. */
  isWide: boolean;
  /** Columns for a card grid. */
  columns: number;
  /** Horizontal page padding. */
  gutter: number;
  /** Content is centred past this width so lines stay readable. */
  maxContentWidth: number;
}

export function useResponsive(): Responsive {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;
  const isWide = width >= WIDE_BREAKPOINT;

  return {
    width,
    isTablet,
    isWide,
    columns: isWide ? 3 : isTablet ? 2 : 1,
    gutter: isTablet ? 24 : 16,
    maxContentWidth: 900,
  };
}
