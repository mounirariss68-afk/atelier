// Brand tokens for the Citizen Services Concierge officer console.
import { getDemoAccent } from "@workspace/cognirise-content";

export const BRAND = getDemoAccent("citizen-services-concierge", "#5BA98A");
export const BRAND_INK = "#1F4F3F";
export const BRAND_MUTED = "#E8F2EC";
export const NAVY = "#0A1230";
export const CANVAS = "#F4F6F8";

export const SEVERITY = {
  critical: "#E30613",
  high:     "#F59E0B",
  medium:   "#3B82F6",
  info:     "#8B5CF6",
  ok:       "#10B981",
} as const;
