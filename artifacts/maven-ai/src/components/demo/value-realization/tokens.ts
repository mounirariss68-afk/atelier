// Brand tokens for the CFO Benefits Cockpit. Accent comes from
// `marketplaceTools["value-realization"].accent` (#F5A623 — Maven amber)
// in `lib/maven-content/src/knowledge.ts`. Per the shared design language
// doc, every hex used by this surface flows through this module so future
// restyles are one-line changes.
import { getDemoAccent } from "@workspace/maven-content";

export const BRAND = getDemoAccent("value-realization");
export const BRAND_INK = "#0E2841";
export const BRAND_MUTED = "#FCEFD5";

export const NAVY = "#0E2841";
export const CANVAS = "#F4F6F8";
export const SURFACE = "#FFFFFF";
export const BORDER = "#E5E7EB";

export const SEMANTIC = {
  good: "#10B981",
  attention: "#F59E0B",
  critical: "#E30613",
  ai: "#8B5CF6",
  info: "#3B82F6",
  ink: "#0E2841",
};

/** 5-colour chart palette anchored on the brand accent. */
export const CHART_PALETTE = [
  BRAND,
  "#3B82F6",
  "#196B24",
  "#8B5CF6",
  "#9CA3AF",
];
