import * as React from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, Activity } from "lucide-react";
import { SectionHead, MonoChip, Card } from "@/components/ui/primitives";
import { AuditTab } from "@/components/AuditTab";

const TABS = [
  { id: "trace", label: "Trace" },
  { id: "io", label: "Input / Output" },
  { id: "tools", label: "Tool Calls" },
  { id: "audit", label: "Audit Trail" },
];

export default function AgentRun() {
  const [, params] = useRoute("/agents/runs/:runId");
  const runId = params?.runId ?? "";
  const [activeTab, setActiveTab] = React.useState("trace");

  return (
    <div className="container-atelier py-8 space-y-8 animate-in fade-in">
      <div>
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 text-xs font-mono text-text-mute hover:text-text mb-6 transition-colors"
          data-testid="link-back-agents"
        >
          <ArrowLeft className="w-4 h-4" /> Back to agents
        </Link>

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <SectionHead
            eyebrow="Agent run"
            headline={runId}
            lede={
              <div className="flex items-center gap-3 mt-2">
                <MonoChip tone="green">COMPLETE</MonoChip>
                <span className="font-mono text-xs text-text-mute">{runId}</span>
              </div>
            }
          />
        </div>
      </div>

      <div className="border-b border-border">
        <div className="flex gap-6 overflow-x-auto scrollbar-thin">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              data-testid={`tab-agentrun-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                activeTab === tab.id
                  ? "border-gold text-gold"
                  : "border-transparent text-text-mute hover:text-text"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="py-4">
        {activeTab === "audit" ? (
          <AuditTab entityType="agent_run" entityId={runId} />
        ) : (
          <Card className="p-12 flex flex-col items-center justify-center text-center border-dashed bg-bg-deep">
            <div className="w-12 h-12 bg-bg-elevate rounded-full flex items-center justify-center mb-4 text-gold">
              <Activity className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-text mb-2">
              {TABS.find((t) => t.id === activeTab)?.label}
            </h3>
            <p className="text-text-mute max-w-md">
              Trace and tool-call inspector ship in a later workstream.
              Foundation registers the run shell, audit trail, and PDF export.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
