import * as React from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, FileText } from "lucide-react";
import { SectionHead, MonoChip, Card } from "@/components/ui/primitives";
import { AuditTab } from "@/components/AuditTab";

const TABS = [
  { id: "summary", label: "Summary" },
  { id: "versions", label: "Versions" },
  { id: "evidence", label: "Evidence" },
  { id: "audit", label: "Audit Trail" },
];

export default function Deliverable() {
  const [, params] = useRoute("/engagements/:engId/deliverables/:delId");
  const engId = params?.engId ?? "";
  const delId = params?.delId ?? "";
  const [activeTab, setActiveTab] = React.useState("summary");

  return (
    <div className="container-atelier py-8 space-y-8 animate-in fade-in">
      <div>
        <Link
          href={`/engagements/${engId}`}
          className="inline-flex items-center gap-2 text-xs font-mono text-text-mute hover:text-text mb-6 transition-colors"
          data-testid="link-back-engagement"
        >
          <ArrowLeft className="w-4 h-4" /> Back to engagement
        </Link>

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <SectionHead
            eyebrow="Deliverable"
            headline={delId.replace(/^del_/, "").replace(/_/g, " ")}
            lede={
              <div className="flex items-center gap-3 mt-2">
                <MonoChip tone="gold">DRAFT</MonoChip>
                <span className="font-mono text-xs text-text-mute">{delId}</span>
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
              data-testid={`tab-deliverable-${tab.id}`}
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
          <AuditTab entityType="deliverable" entityId={delId} />
        ) : (
          <Card className="p-12 flex flex-col items-center justify-center text-center border-dashed bg-bg-deep">
            <div className="w-12 h-12 bg-bg-elevate rounded-full flex items-center justify-center mb-4 text-gold">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-text mb-2">
              {TABS.find((t) => t.id === activeTab)?.label}
            </h3>
            <p className="text-text-mute max-w-md">
              Detail view ships in a later workstream. Foundation registers the
              deliverable shell, audit trail, and PDF export.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
