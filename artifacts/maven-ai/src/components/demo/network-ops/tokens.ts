import { getDemoAccent } from "@workspace/maven-content";

export const BRAND = getDemoAccent("network-ops-war-room", "#156082");
export const BRAND_DARK = "#0E4B66";
export const ACCENT_AMBER = "#F5A623";
export const ACCENT_RED = "#D9534F";
export const ACCENT_GREEN = "#5BA98A";
export const ACCENT_GREY = "#5C8CA8";
export const SUBTITLE = "#4B5563";

export const SEV_BG: Record<string, string> = {
  p1: "bg-red-100 text-red-700 border-red-200",
  p2: "bg-amber-100 text-amber-700 border-amber-200",
  p3: "bg-yellow-100 text-yellow-700 border-yellow-200",
  p4: "bg-gray-100 text-gray-700 border-gray-200",
};
