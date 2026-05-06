// Customer Care Hive — read-only React hook over the static seed.
// Mirrors the shape of useTasamaData but skips the network round-trip
// because the seed is shipped in-bundle for the demo.

import { useMemo } from "react";
import {
  CARE_CONVERSATIONS, CARE_AGENTS, CARE_CUSTOMERS, KB_ARTICLES,
  CARE_NOTIFICATIONS, KB_SUGGESTIONS, CHANNEL_QUEUES, MACROS,
  type CareConversation, type CareAgent, type CareCustomer, type KbArticle,
  type CareNotification, type KbSuggestion, type ChannelQueue, type Macro,
} from "@/data/customer-care-seed";

export interface CareData {
  conversations: CareConversation[];
  agents: CareAgent[];
  customers: CareCustomer[];
  kb: KbArticle[];
  notifications: CareNotification[];
  kbSuggestions: KbSuggestion[];
  channelQueues: ChannelQueue[];
  macros: Macro[];
}

export function useCustomerCareData(): CareData {
  return useMemo(() => ({
    conversations: CARE_CONVERSATIONS,
    agents: CARE_AGENTS,
    customers: CARE_CUSTOMERS,
    kb: KB_ARTICLES,
    notifications: CARE_NOTIFICATIONS,
    kbSuggestions: KB_SUGGESTIONS,
    channelQueues: CHANNEL_QUEUES,
    macros: MACROS,
  }), []);
}
