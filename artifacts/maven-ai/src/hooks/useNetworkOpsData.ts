/**
 * useNetworkOpsData
 *
 * Provider-style hook that surfaces the derived `NetworkOpsAgentData`
 * snapshot to NOC Director Console views. Today the data is computed
 * synchronously from the static seed + scenario; the hook gives us a
 * single seam to swap in async fetching later without touching views.
 */

import { useMemo } from "react";
import { getNetworkOpsAgentData, type NetworkOpsAgentData } from "@/data/network-ops-agent";

export function useNetworkOpsData(): NetworkOpsAgentData {
  return useMemo(() => getNetworkOpsAgentData(), []);
}

export type { NetworkOpsAgentData };
