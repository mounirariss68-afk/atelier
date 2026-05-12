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
    if (!form.name.trim() || !form.accountName.trim()) {
      toast({ title: "Name & account required", variant: "destructive" });
      return;
    }
    const res = await create.mutateAsync({ data: { ...form } });
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
            Lands in <span className="font-mono text-gold">identify</span>. If Pursuit Scout is enabled, an evidence-cited brief is drafted on creation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-3">
          <div className="grid gap-2">
            <Label htmlFor="o-name">Opportunity name</Label>
            <Input
              id="o-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-bg-deep border-border text-text"
              placeholder="e.g. AI-led pricing diagnostic"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="o-acct">Account</Label>
              <Input
                id="o-acct"
                value={form.accountName}
                onChange={(e) => setForm({ ...form, accountName: e.target.value })}
                className="bg-bg-deep border-border text-text"
                placeholder="Account name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="o-country">Country</Label>
              <Input
                id="o-country"
                value={form.accountCountry}
                onChange={(e) => setForm({ ...form, accountCountry: e.target.value })}
                className="bg-bg-deep border-border text-text"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="o-sector">Sector</Label>
            <Input
              id="o-sector"
              value={form.accountSector}
              onChange={(e) => setForm({ ...form, accountSector: e.target.value })}
              className="bg-bg-deep border-border text-text"
              placeholder="e.g. Industrials, Banking, Healthcare"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="o-context">Context for the Scout</Label>
            <Textarea
              id="o-context"
              value={form.contextBlurb}
              onChange={(e) => setForm({ ...form, contextBlurb: e.target.value })}
              className="bg-bg-deep border-border text-text min-h-[88px]"
              placeholder="What does the partner know already? Where is the buyer in their thinking?"
            />
          </div>
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
