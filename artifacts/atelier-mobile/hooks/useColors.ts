import colors from "@/constants/colors";
import { useThemeScheme } from "@/contexts/ThemeContext";

/**
 * Returns the design tokens for the active color scheme.
 *
 * The scheme is resolved by the app-level ThemeContext (system / light /
 * dark), so a user override in Settings drives every screen. Includes
 * scheme-independent values like `radius`.
 */
export function useColors() {
  const scheme = useThemeScheme();
  const palette = scheme === "dark" ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
