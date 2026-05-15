import * as React from "react";
import { Link, useLocation, useRoute } from "wouter";
import { Card, PageHero, SectionHead, MonoChip } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";

interface WinTheme {
  id: string;
  tag: string;
  name: string;
  description: string | null;
  polarity: string;
  supportCount: number;
  offeringTags: string[];
  sectorTags: string[];
  positioningLine: string | null;
  contributingDebriefIds: string[];
  lastSeenAt: string | null;
}
interface DebriefRow {
  id: string;
  opportunityId: string;
  opportunityName: string;
  outcome: string;
  status: string;
  hiddenCompetitor: string | null;
  themeCount: number;
  dueAt: string | null;
  approvedAt: string | null;
  createdAt: string;
}

/**
 * /win-loss          → theme library (default surface; PRD §5.2 — themes-first)
 * /win-loss/debriefs → debrief library (drill-down to per-opp workspace)
 *
 * Theme library is searchable + filterable by polarity / offering / sector
 * with aggregate counts and a per-theme drill-down (modal-style expand)
 * that shows the contributing debriefs and the ready-to-paste positioning line.
 */
export default function WinLossLibrary({
  defaultView,
}: { defaultView?: "themes" | "debriefs" } = {}) {
  const [matchDebriefs] = useRoute("/win-loss/debriefs");
  const [location] = useLocation();
  // Lens-aware tab hrefs: when mounted under /clients/* the themes tab
  // stays inside the lens (`/clients/references`); debriefs intake is
  // an opportunity-stage activity, so it deep-links into the standalone
  // `/win-loss/debriefs` mount rather than synthesising a section that
  // no longer exists in the flat IA. The legacy `/win-loss[/debriefs]`
  // mounts keep their own pair of hrefs.
  const inClientsLens = location.startsWith("/clients/");
  const themesHref = inClientsLens ? "/clients/references" : "/win-loss";
  const debriefsHref = "/win-loss/debriefs";
  const view: "themes" | "debriefs" = matchDebriefs
    ? "debriefs"
    : (defaultView ?? "themes");

  return (
    <div className="p-6 md:p-10 space-y-6 max-w-6xl">
      <PageHero
        eyebrow="WIN/LOSS · LIBRARY"
        title={view === "themes" ? "Win Themes" : "All debriefs"}
        subtitle={
          view === "themes"
            ? "Curated patterns from approved Win/Loss debriefs — what AICo wins on, and where we lose."
            : "Closed-deal Win/Loss debriefs across the firm."
        }
      />
      <div className="flex gap-2 text-sm font-mono">
        <Link
          href={themesHref}
          className={`px-3 py-1 rounded ${view === "themes" ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"}`}
        >
          Themes
        </Link>
        <Link
          href={debriefsHref}
          className={`px-3 py-1 rounded ${view === "debriefs" ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"}`}
        >
          Debriefs
        </Link>
      </div>
      {view === "themes" ? (
        <ThemesView debriefsHref={debriefsHref} />
      ) : (
        <DebriefsView />
      )}
    </div>
  );
}

function ThemesView({ debriefsHref }: { debriefsHref: string }) {
  const [themes, setThemes] = React.useState<WinTheme[] | null>(null);
  const [q, setQ] = React.useState("");
  const [polarity, setPolarity] = React.useState<"all" | "win" | "loss">("all");
  const [openId, setOpenId] = React.useState<string | null>(null);
  React.useEffect(() => {
    fetch("/api/atelier/win-themes", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setThemes(d.themes ?? []))
      .catch(() => setThemes([]));
  }, []);
  if (!themes) return <Skeleton className="h-32 bg-bg-elevate" />;
  const filtered = themes.filter((t) => {
    if (polarity !== "all" && t.polarity !== polarity) return false;
    if (!q.trim()) return true;
    const hay = `${t.tag} ${t.name} ${t.description ?? ""} ${t.offeringTags.join(" ")} ${t.sectorTags.join(" ")}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });
  const wins = themes.filter((t) => t.polarity === "win").length;
  const losses = themes.filter((t) => t.polarity === "loss").length;
  const totalSupport = themes.reduce((a, t) => a + (t.supportCount ?? 0), 0);
  return (
    <>
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-6 text-sm">
          <div>
            <div className="text-text-faint font-mono text-xs uppercase">Themes</div>
            <div className="text-2xl font-semibold mt-1">{themes.length}</div>
          </div>
          <div>
            <div className="text-text-faint font-mono text-xs uppercase">Win / Loss</div>
            <div className="text-2xl font-semibold mt-1">
              <span className="text-success">{wins}</span>{" "}
              <span className="text-text-faint">/</span>{" "}
              <span className="text-danger">{losses}</span>
            </div>
          </div>
          <div>
            <div className="text-text-faint font-mono text-xs uppercase">Debrief support</div>
            <div className="text-2xl font-semibold mt-1 text-gold">{totalSupport}</div>
          </div>
        </div>
      </Card>
      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="Search tag, name, sector, offering…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="bg-bg-elevate border-border max-w-md"
        />
        {(["all", "win", "loss"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPolarity(p)}
            className={`px-3 py-1 rounded text-sm font-mono ${
              polarity === p ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      <SectionHead title={`${filtered.length} ${polarity === "all" ? "" : polarity + " "}themes`} />
      <div className="grid gap-3">
        {filtered.map((t) => {
          const open = openId === t.id;
          return (
            <Card key={t.id} className="p-4 hover:border-gold/50 transition-colors">
              <button
                onClick={() => setOpenId(open ? null : t.id)}
                className="w-full text-left flex flex-wrap gap-3 items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="font-medium text-text flex gap-2 items-center flex-wrap">
                    {t.name}
                    <MonoChip>{t.tag}</MonoChip>
                    <MonoChip>{t.polarity}</MonoChip>
                  </div>
                  <div className="flex gap-2 items-center text-xs flex-wrap">
                    {t.offeringTags.map((tag) => (
                      <MonoChip key={`o${tag}`}>{tag}</MonoChip>
                    ))}
                    {t.sectorTags.map((tag) => (
                      <MonoChip key={`s${tag}`}>{tag}</MonoChip>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-text-mute font-mono">
                  {t.supportCount} debrief{t.supportCount === 1 ? "" : "s"}
                </div>
              </button>
              {open && (
                <div className="mt-4 pt-4 border-t border-border-soft space-y-3 text-sm">
                  {t.description && <p className="text-text-mute">{t.description}</p>}
                  {t.positioningLine && (
                    <div className="bg-bg-elevate rounded p-3">
                      <div className="text-xs font-mono uppercase text-gold mb-1">
                        Positioning line (Composer-ready)
                      </div>
                      <p className="italic">"{t.positioningLine}"</p>
                    </div>
                  )}
                  <div className="text-xs font-mono text-text-faint">
                    Contributing debriefs: {t.contributingDebriefIds.length}
                    {t.contributingDebriefIds.length > 0 && (
                      <Link
                        href={debriefsHref}
                        className="ml-2 text-gold underline"
                      >
                        Browse all →
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <Card className="p-6 text-text-mute">No themes match.</Card>
        )}
      </div>
    </>
  );
}

function DebriefsView() {
  const [items, setItems] = React.useState<DebriefRow[] | null>(null);
  React.useEffect(() => {
    fetch("/api/atelier/win-loss/debriefs", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  }, []);
  if (!items) return <Skeleton className="h-32 bg-bg-elevate" />;
  return (
    <>
      <SectionHead title={`${items.length} debriefs`} />
      <div className="grid gap-3">
        {items.map((it) => (
          <Card key={it.id} className="p-4 hover:border-gold/50 transition-colors">
            <Link
              href={`/opportunities/${it.opportunityId}/win-loss`}
              className="flex flex-wrap gap-3 items-center justify-between"
            >
              <div className="space-y-1">
                <div className="font-medium text-text">{it.opportunityName}</div>
                <div className="flex gap-2 items-center text-xs">
                  <MonoChip>{it.outcome}</MonoChip>
                  <MonoChip>{it.status}</MonoChip>
                  {it.hiddenCompetitor && <MonoChip>vs {it.hiddenCompetitor}</MonoChip>}
                  <span className="text-text-faint">{it.themeCount} themes</span>
                </div>
              </div>
              <div className="text-xs text-text-mute font-mono">
                {it.approvedAt
                  ? `Approved ${new Date(it.approvedAt).toLocaleDateString()}`
                  : it.dueAt
                  ? `Due ${new Date(it.dueAt).toLocaleDateString()}`
                  : new Date(it.createdAt).toLocaleDateString()}
              </div>
            </Link>
          </Card>
        ))}
        {items.length === 0 && (
          <Card className="p-6 text-text-mute">
            No debriefs yet. They appear automatically when opps close.
          </Card>
        )}
      </div>
    </>
  );
}
