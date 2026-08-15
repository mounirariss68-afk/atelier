/**
 * walletTabs — single shared definition of the Firm > Wallet sub-navigation
 * (Task fixing drifted per-page copies). Every wallet page renders
 * `<WalletTabs group="…" />` instead of its own literal tab array, so the
 * menu can never drift between pages again.
 *
 * Groups:
 *  - "main":  the primary Wallet menu (Expenses · Invoices · AR aging ·
 *             Collections · + New expense · Cards · Policy · VAT register).
 *             Policy/VAT stay hidden for non-leadership roles.
 *  - "cash":  Expenses · Cash · Bank reconciliation · Treasury · AR aging.
 *             ("Expenses" links back to the main Wallet home, matching the
 *             revrec/approvals groups.)
 *  - "revrec": Expenses · Rev-rec · WIP · Margin & leakage.
 *  - "approvals": Expenses · Approvals · Cards.
 */

import * as React from "react";
import { SubSectionTabs, type SubSectionTab } from "@/components/layout/SubSectionTabs";
import { useAuth } from "@/lib/auth";

export type WalletTabGroup = "main" | "cash" | "revrec" | "approvals";

// Task #292 — wallet leadership = partner-tier + finance.
const LEADER_ROLES = ["founding_partner", "partner", "finance"] as const;

export function walletTabsFor(group: WalletTabGroup, isLeader: boolean): SubSectionTab[] {
  switch (group) {
    case "main":
      return [
        { id: "expenses", label: "Expenses", href: "/wallet" },
        { id: "invoices", label: "Invoices", href: "/wallet/invoices" },
        { id: "ar", label: "AR aging", href: "/wallet/ar" },
        { id: "collections", label: "Collections", href: "/wallet/collections" },
        { id: "expenses-new", label: "+ New expense", href: "/wallet/expenses/new" },
        { id: "cards", label: "Cards", href: "/wallet/cards" },
        { id: "policy", label: "Policy", href: "/wallet/policy", hidden: !isLeader },
        { id: "vat", label: "VAT register", href: "/wallet/vat", hidden: !isLeader },
      ];
    case "cash":
      return [
        { id: "expenses", label: "Expenses", href: "/wallet" },
        { id: "cash", label: "Cash", href: "/wallet/cash" },
        { id: "cash-recon", label: "Bank reconciliation", href: "/wallet/cash/recon" },
        { id: "treasury", label: "Treasury", href: "/wallet/treasury" },
        { id: "ar", label: "AR aging", href: "/wallet/ar" },
      ];
    case "revrec":
      return [
        { id: "expenses", label: "Expenses", href: "/wallet" },
        { id: "revrec", label: "Rev-rec", href: "/wallet/revrec" },
        { id: "wip", label: "WIP", href: "/wallet/wip" },
        { id: "margin", label: "Margin & leakage", href: "/wallet/margin" },
      ];
    case "approvals":
      return [
        { id: "expenses", label: "Expenses", href: "/wallet" },
        { id: "approvals", label: "Approvals", href: "/wallet/approvals" },
        { id: "cards", label: "Cards", href: "/wallet/cards" },
      ];
  }
}

export function WalletTabs({ group }: { group: WalletTabGroup }) {
  const { user } = useAuth();
  const isLeader = user != null && (LEADER_ROLES as readonly string[]).includes(user.role);
  const tabs = React.useMemo(() => walletTabsFor(group, isLeader), [group, isLeader]);
  // px-6 keeps the strip aligned with the px-6 page content below it.
  return <SubSectionTabs tabs={tabs} className="px-6" />;
}
