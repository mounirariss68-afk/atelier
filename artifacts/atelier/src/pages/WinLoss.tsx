import * as React from "react";
import { useRoute, Link } from "wouter";
import { Card, PageHero, SectionHead, MonoChip, PillButton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAtelierGetMe } from "@workspace/api-client-react";

interface WinLossTheme {
  name: string;
  tag: string;
  evidenceQuote: string;
  polarity: "win" | "loss";
}
interface WinLossDebrief {
  id: string;
  opportunityId: string;
  outcome: string;
  status: "pending" | "ingested" | "synthesized" | "approved";
  sellerPerceivedReasons: string[];
  sellerNotes: string | null;
  buyerTranscript: string | null;
  buyerAuthenticReasons: string[] | null;
  hiddenCompetitor: string | null;
  themes: WinLossTheme[] | null;
  whatWeWouldDoDifferently: string | null;
  suggestedAtelierLessons: Array<{ title: string; abstract: string; kind: string }> | null;
  dueAt: string | null;
  synthesizedAt: string | null;
  approvedAt: string | null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}

export default function WinLoss() {
  const [, params] = useRoute<{ oppId: string }>("/opportunities/:oppId/win-loss");
  const oppId = params?.oppId ?? "";
  const { data: me } = useAtelierGetMe();
  const { toast } = useToast();
  const [debrief, setDebrief] = React.useState<WinLossDebrief | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [reasons, setReasons] = React.useState("");
  const [transcript, setTranscript] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ debrief: WinLossDebrief | null }>(`/api/atelier/opportunities/${oppId}/win-loss`);
      setDebrief(r.debrief);
      if (r.debrief) {
        setReasons((r.debrief.sellerPerceivedReasons ?? []).join("\n"));
        setTranscript(r.debrief.buyerTranscript ?? "");
      }
    } catch (e) {
      toast({ variant: "destructive", title: "Could not load debrief" });
    } finally {
      setLoading(false);
    }
  }, [oppId, toast]);

  React.useEffect(() => {
    if (oppId) void reload();
  }, [oppId, reload]);

  const saveSeller = async () => {
    setBusy("seller");
    try {
      await api(`/api/atelier/opportunities/${oppId}/win-loss/seller`, {
        method: "PATCH",
        body: JSON.stringify({
          sellerPerceivedReasons: reasons.split("\n").map((s) => s.trim()).filter(Boolean),
        }),
      });
      toast({ title: "Seller view saved" });
      await reload();
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally {
      setBusy(null);
    }
  };
  const uploadTranscript = async () => {
    setBusy("transcript");
    try {
      await api(`/api/atelier/opportunities/${oppId}/win-loss/transcript`, {
        method: "POST",
        body: JSON.stringify({ transcript }),
      });
      toast({ title: "Transcript ingested" });
      await reload();
    } catch {
      toast({ variant: "destructive", title: "Upload failed (need ≥20 chars)" });
    } finally {
      setBusy(null);
    }
  };
  const runInterviewer = async () => {
    setBusy("run");
    try {
      await api(`/api/atelier/opportunities/${oppId}/win-loss/run`, { method: "POST" });
      toast({ title: "Interviewer synthesized" });
      await reload();
    } catch {
      toast({ variant: "destructive", title: "Run failed" });
    } finally {
      setBusy(null);
    }
  };
  const approve = async () => {
    setBusy("approve");
    try {
      await api(`/api/atelier/opportunities/${oppId}/win-loss/approve`, { method: "POST" });
      toast({ title: "Debrief approved" });
      await reload();
    } catch {
      toast({ variant: "destructive", title: "Approve failed (partner only)" });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="p-8 space-y-4"><Skeleton className="h-32 bg-bg-elevate" /></div>;
  if (!debrief)
    return (
      <div>
        <PageHero>
          <SectionHead eyebrow="Win/Loss" headline="No debrief yet" />
        </PageHero>
        <div className="p-8 max-w-3xl">
          <p className="text-text-mute mt-3">
            A debrief is auto-created when the opportunity closes (signed / lost / withdrawn).
          </p>
          <Link href={`/opportunities/${oppId}`} className="text-gold underline mt-4 inline-block">
            ← Back to opportunity
          </Link>
        </div>
      </div>
    );

  const isPartner = (me?.role === "partner" || me?.role === "founding_partner");
  return (
    <div>
      <PageHero>
        <SectionHead
          eyebrow={`WIN/LOSS · ${debrief.outcome.replace(/_/g, " ").toUpperCase()}`}
          headline="Debrief workspace"
          lede={
            debrief.dueAt
              ? `Due by ${new Date(debrief.dueAt).toLocaleDateString()} · status: ${debrief.status}`
              : `Status: ${debrief.status}`
          }
        />
      </PageHero>
      <div className="p-6 md:p-10 space-y-8 max-w-5xl">
      <Card className="p-5 space-y-3">
        <SectionHead headline="Seller view" />
        <p className="text-xs text-text-mute">
          What the seller believes happened. One reason per line. (Research is unanimous: this is
          NOT what the buyer will say.)
        </p>
        <Textarea
          value={reasons}
          onChange={(e) => setReasons(e.target.value)}
          rows={5}
          placeholder="e.g. Champion changed roles&#10;Lost on price"
          className="bg-bg-elevate border-border text-text font-mono text-sm"
        />
        <Button onClick={saveSeller} disabled={busy === "seller"}>
          Save seller view
        </Button>
      </Card>

      <Card className="p-5 space-y-3">
        <SectionHead headline="Buyer transcript (async ingest)" />
        <p className="text-xs text-text-mute">
          Paste the buyer-side interview transcript. v2 supports async ingest only — no live
          interview wired.
        </p>
        <Textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={10}
          placeholder="Paste buyer interview transcript here…"
          className="bg-bg-elevate border-border text-text font-mono text-sm"
        />
        <div className="flex gap-3">
          <Button onClick={uploadTranscript} disabled={busy === "transcript" || transcript.length < 20}>
            Upload transcript
          </Button>
          <Button
            variant="outline"
            onClick={runInterviewer}
            disabled={busy === "run"}
          >
            Run Win/Loss Interviewer ★
          </Button>
        </div>
      </Card>

      {debrief.themes && debrief.themes.length > 0 && (
        <Card className="p-5 space-y-3">
          <SectionHead headline="Synthesized themes" />
          {debrief.hiddenCompetitor && (
            <div className="text-sm">
              <span className="font-mono text-text-mute">Hidden competitor: </span>
              <MonoChip>{debrief.hiddenCompetitor}</MonoChip>
            </div>
          )}
          <ul className="space-y-3">
            {debrief.themes.map((t, i) => (
              <li key={i} className="border-l-4 border-l-gold pl-3 py-1">
                <div className="font-medium text-text flex gap-2 items-center">
                  {t.name}
                  <MonoChip>{t.tag}</MonoChip>
                  <MonoChip>{t.polarity}</MonoChip>
                </div>
                <blockquote className="text-sm text-text-mute italic mt-1">
                  "{t.evidenceQuote}"
                </blockquote>
              </li>
            ))}
          </ul>
          {debrief.whatWeWouldDoDifferently && (
            <div className="mt-3 p-3 bg-bg-elevate/50 rounded text-sm">
              <span className="font-mono text-xs uppercase text-gold">What we'd do differently</span>
              <p className="mt-1">{debrief.whatWeWouldDoDifferently}</p>
            </div>
          )}
        </Card>
      )}

      {debrief.status === "synthesized" && (
        <Card className="p-5 space-y-3 border-l-4 border-l-gold">
          <SectionHead headline="Partner approval" />
          <p className="text-sm text-text-mute">
            Approving locks the debrief, resolves the Pane A reminder, and feeds the themes
            into the Theme Curator.
          </p>
          <Button onClick={approve} disabled={!isPartner || busy === "approve"}>
            {isPartner ? "Approve debrief" : "Partner approval required"}
          </Button>
        </Card>
      )}

      {debrief.approvedAt && (
        <div className="text-sm text-success">
          Approved {new Date(debrief.approvedAt).toLocaleString()}
        </div>
      )}
      </div>
    </div>
  );
}
