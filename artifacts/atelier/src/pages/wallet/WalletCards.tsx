import * as React from "react";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { SubSectionTabs } from "@/components/layout/SubSectionTabs";

interface CorporateCard {
  id: string;
  cardholderUserId: string;
  cardholderName: string;
  last4: string;
  network: string;
  issuingCurrency: string;
  monthlyLimitUsd: number;
  active: boolean;
  linkedAt: string;
}

export default function WalletCards() {
  const [cards, setCards] = React.useState<CorporateCard[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    void fetch("/api/atelier/wallet/cards", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => { setCards(j.cards ?? []); setLoading(false); });
  }, []);

  return (
    <div className="min-h-screen text-text">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Wallet"
          headline="Corporate cards"
          lede="Card-feed lines auto-flow into expense drafts; reconciled at submit."
        />
      </PageHero>
      <SubSectionTabs
        tabs={[
        { id: "expenses", label: "Expenses", href: "/wallet" },
        { id: "expenses-new", label: "+ New expense", href: "/wallet/expenses/new" },
        { id: "cards", label: "Cards", href: "/wallet/cards" },
      ]}
      />
      <div className="px-6 py-4 max-w-5xl mx-auto">
        {loading && <div className="text-text-mute">Loading…</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map((c) => (
            <Card key={c.id} className="p-5 bg-gradient-to-br from-bg-elevate to-bg-deep border-l-4 border-l-gold" data-testid={`card-${c.id}`}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xs font-mono uppercase tracking-wider text-text-mute">{c.network}</div>
                  <div className="text-xl font-mono mt-2 tracking-wider">•••• •••• •••• {c.last4}</div>
                  <div className="text-sm text-text mt-3">{c.cardholderName}</div>
                </div>
                <div className="text-right space-y-1">
                  <MonoChip tone={c.active ? "green" : "red"}>{c.active ? "active" : "frozen"}</MonoChip>
                  <div className="text-[10px] font-mono text-text-mute">{c.issuingCurrency}</div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-border-soft text-xs font-mono flex justify-between">
                <span className="text-text-mute">Monthly limit</span>
                <span>${c.monthlyLimitUsd.toLocaleString()}</span>
              </div>
            </Card>
          ))}
          {!loading && cards.length === 0 && (
            <Card className="p-6 text-center text-text-mute md:col-span-2">No cards linked.</Card>
          )}
        </div>
      </div>
    </div>
  );
}
