import * as React from "react";
import { Link } from "wouter";
import { Card, SectionHead, MonoChip } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";

/**
 * Win/Loss reference — curated themes library.
 *
 * Mounted at `/clients/reference` (Clients lens, Reference stage).
 * The companion intake workbench (debriefs in flight) lives at
 * `/clients/win` and is rendered by `WinLossIntake`.
 *
 * This surface is the synthesized output: searchable, polarity-
 * filterable themes with aggregate counts and a per-theme drill-down
 * that exposes the ready-to-paste positioning line and contributing
 * debrief count, plus a deep link back to the intake workbench.
 */

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

export default function WinLossLibrary() {
  // Intake workbench is reachable via the standalone `/win-loss`
  // route in the flat-IA Clients lens — there's no `/clients/win`
  // section, so cross-links target `/win-loss` directly.
  const intakeHref = "/win-loss";
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

  return (
    <div className="space-y-6">
      <LensPageHeader
        headline="Win Themes"
        lede="Curated patterns from approved Win/Loss debriefs — what Cognirise wins on, and where we lose."
      />

      <div className="container-atelier py-6 space-y-6">
        <div className="flex gap-2 text-sm font-mono">
          <Link
            href={intakeHref}
            className="px-3 py-1 rounded bg-bg-elevate/50 text-text-mute hover:text-text"
          >
            ← Debriefs intake
          </Link>
          <span className="px-3 py-1 rounded bg-gold text-bg">Themes</span>
        </div>

        {!themes ? (
          <Skeleton className="h-32 bg-bg-elevate" />
        ) : (
          <ThemesView
            themes={themes}
            q={q}
            setQ={setQ}
            polarity={polarity}
            setPolarity={setPolarity}
            openId={openId}
            setOpenId={setOpenId}
            intakeHref={intakeHref}
          />
        )}
      </div>
    </div>
  );
}

function ThemesView({
  themes,
  q,
  setQ,
  polarity,
  setPolarity,
  openId,
  setOpenId,
  intakeHref,
}: {
  themes: WinTheme[];
  q: string;
  setQ: (v: string) => void;
  polarity: "all" | "win" | "loss";
  setPolarity: (v: "all" | "win" | "loss") => void;
  openId: string | null;
  setOpenId: (v: string | null) => void;
  intakeHref: string;
}) {
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
      <SectionHead headline={`${filtered.length} ${polarity === "all" ? "" : polarity + " "}themes`} />
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
                    <div className="bg-bg-elevate/50 rounded p-3">
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
                        href={intakeHref}
                        className="ml-2 text-gold underline"
                      >
                        Open intake →
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
