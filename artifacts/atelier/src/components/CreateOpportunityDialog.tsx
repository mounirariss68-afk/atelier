import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PillButton } from "./ui/primitives";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierCreateOpportunity,
  getAtelierListOpportunitiesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

interface Props {
  trigger: React.ReactNode;
}

export function CreateOpportunityDialog({ trigger }: Props) {
  const [open, setOpen] = React.useState(false);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useAtelierCreateOpportunity();

  const [form, setForm] = React.useState({
    name: "",
    accountName: "",
    accountCountry: "Türkiye",
    accountSector: "Industrials",
    contextBlurb: "",
    runScout: true,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Opportunity name required", variant: "destructive" });
      return;
    }
    const accountName = form.accountName.trim() || form.name.trim();
    const res = await create.mutateAsync({
      data: {
        ...form,
        accountName,
        accountCountry: form.accountCountry || "Türkiye",
        accountSector: form.accountSector || "Cross-sector",
      },
    });
    qc.invalidateQueries({ queryKey: getAtelierListOpportunitiesQueryKey() });
    toast({
      title: "Opportunity created",
      description: form.runScout
        ? "Pursuit Scout is drafting the brief."
        : "Pipeline updated.",
    });
    setOpen(false);
    setLocation(`/pipeline/${res.opportunity.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[640px] bg-bg-elevate border-gold/40 text-text">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">New opportunity</DialogTitle>
          <DialogDescription className="text-text-mute">
            Type a short opportunity name. Lands in <span className="font-mono text-gold">identify</span>; Pursuit Scout drafts an evidence-cited brief on creation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-3">
          <div className="grid gap-2">
            <Label htmlFor="o-name" className="text-xs uppercase tracking-widest font-mono text-text-faint">Opportunity name</Label>
            <Input
              id="o-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value, accountName: form.accountName || e.target.value })}
              className="bg-bg-deep border-border text-text text-lg py-6"
              placeholder="e.g. Tasama — AI pricing diagnostic"
              autoFocus
            />
            <p className="text-xs text-text-faint">
              Account, country, sector and context can be enriched later — leave them blank to let Scout infer from the name.
            </p>
          </div>
          <details className="border border-border-soft rounded p-3 text-sm">
            <summary className="cursor-pointer text-text-mute font-mono text-xs uppercase tracking-widest">Optional context</summary>
            <div className="mt-3 grid gap-3">
              <div className="grid grid-cols-3 gap-2">
                <Input
                  value={form.accountName}
                  onChange={(e) => setForm({ ...form, accountName: e.target.value })}
                  className="bg-bg-deep border-border text-text"
                  placeholder="Account"
                />
                <Input
                  value={form.accountCountry}
                  onChange={(e) => setForm({ ...form, accountCountry: e.target.value })}
                  className="bg-bg-deep border-border text-text"
                  placeholder="Country"
                />
                <Input
                  value={form.accountSector}
                  onChange={(e) => setForm({ ...form, accountSector: e.target.value })}
                  className="bg-bg-deep border-border text-text"
                  placeholder="Sector"
                />
              </div>
              <Textarea
                value={form.contextBlurb}
                onChange={(e) => setForm({ ...form, contextBlurb: e.target.value })}
                className="bg-bg-deep border-border text-text min-h-[60px] text-xs"
                placeholder="Anything the partner knows already…"
              />
            </div>
          </details>
          <label className="flex items-center gap-2 text-sm text-text-mute">
            <input
              type="checkbox"
              checked={form.runScout}
              onChange={(e) => setForm({ ...form, runScout: e.target.checked })}
              className="accent-gold"
            />
            Auto-run Pursuit Scout on creation
          </label>
          <div className="flex justify-end gap-3 pt-3 border-t border-border-soft">
            <PillButton variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</PillButton>
            <PillButton variant="primary" type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create opportunity"}
            </PillButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
