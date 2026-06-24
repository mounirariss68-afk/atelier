import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PillButton, MonoChip } from "./ui/primitives";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierCheckAccountDuplicates,
  useAtelierListAccounts,
  useAtelierMergeAccounts,
  getAtelierListAccountsQueryKey,
  getAtelierGetAccountWorkspaceQueryKey,
  type AtelierAccountDuplicateCandidate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  accountId: string;
  accountName: string;
  brandName?: string | null;
  country?: string | null;
  trigger: React.ReactNode;
}

const labelCls = "text-xs uppercase tracking-widest font-mono text-text-faint";

export function MergeAccountDialog({
  accountId,
  accountName,
  brandName,
  country,
  trigger,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const checkDup = useAtelierCheckAccountDuplicates();
  const merge = useAtelierMergeAccounts();
  const { data: list } = useAtelierListAccounts(undefined, {
    query: { queryKey: getAtelierListAccountsQueryKey(), enabled: open },
  });

  const [candidates, setCandidates] = React.useState<
    AtelierAccountDuplicateCandidate[]
  >([]);
  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setCandidates([]);
      setSearch("");
      setSelectedId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await checkDup.mutateAsync({
          data: {
            name: accountName,
            brandName: brandName || null,
            country: country || null,
          },
        });
        if (!cancelled) setCandidates(res.candidates ?? []);
      } catch {
        if (!cancelled) setCandidates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId, accountName]);

  // Likely duplicates surfaced first; the rest of the book is searchable as a
  // fallback for matches the heuristic misses.
  const candidateIds = new Set(candidates.map((c) => c.id));
  const others = (list ?? []).filter(
    (a) => a.id !== accountId && !candidateIds.has(a.id),
  );
  const q = search.trim().toLowerCase();
  const searchResults = q
    ? others
        .filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            (a.brandName ?? "").toLowerCase().includes(q),
        )
        .slice(0, 8)
    : [];

  const selectedAccount =
    candidates.find((c) => c.id === selectedId) ??
    (list ?? []).find((a) => a.id === selectedId) ??
    null;
  const selectedName =
    selectedAccount && "name" in selectedAccount ? selectedAccount.name : "";

  async function submit() {
    if (!selectedId) return;
    if (
      !window.confirm(
        `Merge "${selectedName}" into "${accountName}"? All contacts, opportunities, engagements and history move to "${accountName}". The duplicate is archived. This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      const res = await merge.mutateAsync({
        accountId,
        data: { duplicateAccountId: selectedId },
      });
      await qc.invalidateQueries({ queryKey: getAtelierListAccountsQueryKey() });
      await qc.invalidateQueries({
        queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId),
      });
      const moved = Object.values(res.counts ?? {}).reduce(
        (s, n) => s + (n as number),
        0,
      );
      toast({
        title:
          res.status === "already_merged"
            ? "Already merged"
            : "Accounts merged",
        description:
          res.status === "already_merged"
            ? "That account was already merged."
            : `${moved} record${moved === 1 ? "" : "s"} re-pointed to ${accountName}.`,
      });
      setOpen(false);
    } catch (e) {
      toast({
        title: "Merge failed",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  function Row({
    id,
    name,
    sub,
    confidence,
  }: {
    id: string;
    name: string;
    sub?: string | null;
    confidence?: string;
  }) {
    const active = selectedId === id;
    return (
      <button
        type="button"
        onClick={() => setSelectedId(active ? null : id)}
        className={`w-full text-left px-3 py-2 rounded border transition-colors ${
          active
            ? "border-gold/70 bg-gold/10"
            : "border-border-soft hover:border-border"
        }`}
        data-testid={`merge-account-candidate-${id}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm text-text">{name}</div>
            {sub && (
              <div className="text-xs font-mono text-text-mute mt-0.5">{sub}</div>
            )}
          </div>
          {confidence && (
            <MonoChip tone={confidence === "high" ? "amber" : undefined}>
              {confidence}
            </MonoChip>
          )}
        </div>
      </button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge a duplicate into {accountName}</DialogTitle>
          <DialogDescription>
            Pick the duplicate account to fold in. Its contacts, opportunities,
            engagements and history move to {accountName} and the duplicate is
            archived.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <div className={labelCls}>Likely duplicates</div>
            {candidates.length === 0 ? (
              <div className="text-xs font-mono text-text-mute px-1">
                No close matches detected — search the account book below.
              </div>
            ) : (
              <div className="space-y-2">
                {candidates.map((c) => (
                  <Row
                    key={c.id}
                    id={c.id}
                    name={c.name}
                    sub={[c.brandName, c.country].filter(Boolean).join(" · ") || null}
                    confidence={c.confidence}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className={labelCls}>Search all accounts</div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or brand…"
              className="bg-bg-deep border-border-soft"
              data-testid="input-merge-account-search"
            />
            {searchResults.length > 0 && (
              <div className="space-y-2">
                {searchResults.map((a) => (
                  <Row
                    key={a.id}
                    id={a.id}
                    name={a.name}
                    sub={[a.brandName, a.country].filter(Boolean).join(" · ") || null}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border-soft">
          <div className="text-xs font-mono text-text-mute">
            {selectedAccount
              ? `Merge "${selectedName}" → "${accountName}"`
              : "Select a duplicate to merge"}
          </div>
          <div className="flex items-center gap-2">
            <PillButton variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </PillButton>
            <PillButton
              variant="primary"
              onClick={submit}
              disabled={!selectedId || merge.isPending}
              data-testid="button-confirm-merge-account"
            >
              {merge.isPending ? "Merging…" : "Merge"}
            </PillButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
