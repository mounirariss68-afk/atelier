import * as React from "react";
import { useAtelierListAudit, getAtelierListAuditQueryKey } from "@workspace/api-client-react";
import type { AtelierListAuditEntityType } from "@workspace/api-client-react";
import { MonoChip } from "./ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";

interface AuditTabProps {
  entityType: AtelierListAuditEntityType;
  entityId: string;
}

export function AuditTab({ entityType, entityId }: AuditTabProps) {
  const { data: auditEvents, isLoading, isError } = useAtelierListAudit(
    { entityType, entityId, limit: 50 },
    {
      query: {
        enabled: !!entityId,
        queryKey: getAtelierListAuditQueryKey({ entityType, entityId, limit: 50 }),
      },
    },
  );

  if (isLoading) {
    return (
      <div className="space-y-4 py-6">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex gap-4">
            <Skeleton className="w-24 h-4 bg-bg-elevate-2" />
            <Skeleton className="w-full h-12 bg-bg-elevate-2" />
          </div>
        ))}
      </div>
    );
  }

  if (isError || !auditEvents) {
    return <div className="py-6 text-danger">Failed to load audit trail.</div>;
  }

  if (auditEvents.length === 0) {
    return <div className="py-8 text-center text-text-mute italic">No audit events found.</div>;
  }

  return (
    <div className="py-6">
      <div className="relative border-l border-border ml-3 space-y-8 pb-8">
        {auditEvents.map((event) => (
          <div key={event.id} className="relative pl-8">
            {/* Timeline dot */}
            <div className="absolute w-2 h-2 rounded-full bg-gold left-[-4.5px] top-2 ring-4 ring-bg" />
            
            <div className="flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-4 mb-1">
              <span className="font-mono text-xs text-text-mute min-w-[140px]">
                {new Date(event.ts).toLocaleString('en-US', { 
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' 
                }).toUpperCase()}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <MonoChip tone={event.actorType === 'agent' ? 'gold' : event.actorType === 'system' ? 'default' : 'green'}>
                  {event.actorType}
                </MonoChip>
                <span className="font-medium text-sm text-text">{event.actorLabel}</span>
                <span className="text-sm text-text-mute">—</span>
                <span className="text-sm font-semibold text-text">{event.action}</span>
              </div>
            </div>
            
            {event.payloadSummary && (
              <div className="mt-2 bg-bg-elevate border border-border rounded p-3 text-sm text-text-mute font-mono">
                {event.payloadSummary}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
