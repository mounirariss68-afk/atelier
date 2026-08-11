import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ConfidenceChip } from "./ui/primitives";
import { ExternalLink } from "lucide-react";
import type { AgentActivityItemConfidence } from "@workspace/api-client-react";

interface Citation {
  title: string;
  url?: string;
  retrievedAt: string;
  confidence: AgentActivityItemConfidence;
  snippet?: string;
}

interface EvidenceDrawerProps {
  trigger: React.ReactNode;
  citations: Citation[];
  title?: string;
}

export function EvidenceDrawer({ trigger, citations, title = "Evidence & Citations" }: EvidenceDrawerProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="bg-bg-deep border-l-border text-text w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="text-xl font-semibold text-text border-b border-border pb-4">{title}</SheetTitle>
        </SheetHeader>
        <div className="space-y-6">
          {citations.length === 0 ? (
            <p className="text-text-mute italic">No citations available.</p>
          ) : (
            citations.map((cite, i) => (
              <div key={i} className="space-y-2 pb-4 border-b border-border-soft last:border-0">
                <div className="flex items-start justify-between gap-4">
                  <h4 className="font-medium text-text text-sm leading-snug">
                    {cite.url ? (
                      <a href={cite.url} target="_blank" rel="noreferrer" className="hover:text-gold transition-colors flex items-center gap-1">
                        {cite.title} <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      cite.title
                    )}
                  </h4>
                  <ConfidenceChip value={cite.confidence} className="shrink-0" />
                </div>
                {cite.snippet && (
                  <div className="glass-surface p-3 rounded text-sm text-text-mute border-l-2 border-border font-serif italic text-sm">
                    "{cite.snippet}"
                  </div>
                )}
                <div className="text-xs font-mono text-text-faint pt-1">
                  RETRIEVED: {cite.retrievedAt}
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
