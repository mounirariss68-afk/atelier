// SAMA Compliance Sentinel — brand & semantic tokens (CRO Obligations Console).
// Anchored on Scenario.accent (#C45BB8 amber) but the chrome stays in
// the platform navy so the surface evokes Workiva / MetricStream rather
// than a "marketing demo".

import { getDemoAccent } from "@workspace/maven-content";

export const BRAND = getDemoAccent("sama-compliance-sentinel", "#0A1230");
export const BRAND_DARK = "#0A1F33";
export const BRAND_INK = "#0A1230";       // platform navy — header & primary text
export const BRAND_MUTED = "#5C6B7A";

export const SURFACE = "#F4F6F8";
export const BORDER = "#E5E7EB";

export const SEMANTIC = {
  good: "#10B981",
  warn: "#F59E0B",
  bad: "#E30613",
  ai: "#8B5CF6",
  info: "#3B82F6",
};

export const CHART = ["#C45BB8", "#0A1230", "#5BA98A", "#3B82F6", "#8B5CF6", "#5C8CA8"];
