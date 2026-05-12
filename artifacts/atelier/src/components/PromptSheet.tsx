import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PillButton } from "./ui/primitives";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

interface PromptSheetProps {
  trigger: React.ReactNode;
  agentName: string;
}

export function PromptSheet({ trigger, agentName }: PromptSheetProps) {
  const [showRaw, setShowRaw] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const { toast } = useToast();

  const handleRun = () => {
    toast({
      title: "Agent Run Queued",
      description: `${agentName} has been queued for execution.`,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[600px] bg-bg-elevate border-border text-text">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-text">Run {agentName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="objective" className="text-text-mute">Objective</Label>
            <Input id="objective" className="bg-bg-deep border-border text-text" placeholder="What should the agent accomplish?" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="audience" className="text-text-mute">Audience</Label>
              <Input id="audience" className="bg-bg-deep border-border text-text" placeholder="e.g. CIO, Board" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="deadline" className="text-text-mute">Deadline</Label>
              <Input id="deadline" type="date" className="bg-bg-deep border-border text-text" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="themes" className="text-text-mute">Must-include themes</Label>
            <Textarea id="themes" className="bg-bg-deep border-border text-text min-h-[80px]" placeholder="Key points to cover..." />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sources" className="text-text-mute">Must-cite sources</Label>
            <Textarea id="sources" className="bg-bg-deep border-border text-text min-h-[80px]" placeholder="URLs, documents, or specific past deliverables..." />
          </div>
          <div className="flex items-center space-x-2 pt-2">
            <Switch id="raw-mode" checked={showRaw} onCheckedChange={setShowRaw} />
            <Label htmlFor="raw-mode" className="text-text-mute">Advanced: Raw prompt mode</Label>
          </div>
          {showRaw && (
            <div className="grid gap-2 animate-in fade-in slide-in-from-top-2">
              <Label htmlFor="raw-prompt" className="text-gold">Raw Prompt (Overrides structured fields)</Label>
              <Textarea id="raw-prompt" className="bg-bg-deep border-gold/50 text-text font-mono text-sm min-h-[120px]" placeholder="System prompt override..." />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t border-border-soft">
          <PillButton variant="ghost" onClick={() => setOpen(false)}>Cancel</PillButton>
          <PillButton variant="primary" onClick={handleRun}>Run agent</PillButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
