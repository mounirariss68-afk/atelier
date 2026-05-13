import * as React from "react";
import {
  useAtelierForgePrototype,
  type AtelierPrototype,
} from "@workspace/api-client-react";
import { Card, PillButton } from "@/components/ui/primitives";
import { Wrench, Copy } from "lucide-react";

export function PrototypeButton({ oppId, oppName }: { oppId: string; oppName: string }) {
  const [open, setOpen] = React.useState(false);
  const [proto, setProto] = React.useState<AtelierPrototype | null>(null);
  const forge = useAtelierForgePrototype({
    mutation: {
      onSuccess: (resp: { prototype: AtelierPrototype }) => {
        setProto(resp.prototype);
        setOpen(true);
      },
    },
  });

  return (
    <>
      <PillButton
        variant="ghost"
        data-testid="button-prototype-forge"
        onClick={() =>
          forge.mutate({
            oppId,
            data: {
              name: `Prototype — ${oppName}`,
              audience: "Client decision-maker",
              problem: "Demonstrate agentic feasibility in 1 week.",
              agenticThesis: "An agent assists; a human always decides.",
              demos: ["Headline workflow", "Audit & override"],
              constraints: ["bilingual-aware", "audit trail"],
              partnerDataApproved: false,
            },
          })
        }
        disabled={forge.isPending}
      >
        <span className="inline-flex items-center gap-1">
          <Wrench className="w-3 h-3" /> {forge.isPending ? "Forging…" : "Prototype"}
        </span>
      </PillButton>
      {open && proto && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setOpen(false)}>
          <Card className="max-w-3xl w-full p-5 space-y-3 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="font-medium text-text">{proto.name}</div>
              <div className="flex items-center gap-2">
                <PillButton
                  variant="ghost"
                  data-testid="button-copy-prompt"
                  onClick={() => navigator.clipboard.writeText(proto.replitPromptMd ?? "")}
                >
                  <span className="inline-flex items-center gap-1"><Copy className="w-3 h-3" /> Copy prompt</span>
                </PillButton>
                <PillButton variant="ghost" onClick={() => setOpen(false)}>Close</PillButton>
              </div>
            </div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap bg-bg-deep border border-border-soft rounded p-3" data-testid="prototype-prompt">
              {proto.replitPromptMd}
            </pre>
          </Card>
        </div>
      )}
    </>
  );
}
