import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { PillButton } from "./ui/primitives";
import { useToast } from "@/hooks/use-toast";

interface ApproveEditRejectProps {
  personaName: string;
  onDecision?: (decision: "approve" | "edit" | "reject", rationale: string) => void;
}

export function ApproveEditReject({ personaName, onDecision }: ApproveEditRejectProps) {
  const [rationale, setRationale] = React.useState("");
  const { toast } = useToast();

  const handleDecision = (decision: "approve" | "edit" | "reject") => {
    if (!rationale.trim() && decision !== "approve") {
      toast({
        title: "Rationale Required",
        description: "Please provide a rationale for edits or rejections.",
        variant: "destructive",
      });
      return;
    }
    
    if (onDecision) {
      onDecision(decision, rationale);
    } else {
      toast({
        title: `Decision: ${decision.toUpperCase()}`,
        description: "This decision has been logged in the audit trail.",
      });
      setRationale("");
    }
  };

  return (
    <div className="bg-bg-elevate border border-border rounded-lg p-5 space-y-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-text-mute">Rationale / Feedback</label>
        <Textarea 
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Required for edit/reject. Optional for approve."
          className="bg-bg-deep border-border text-text min-h-[80px]"
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="text-xs text-text-faint font-mono uppercase tracking-wider">
          Decided by {personaName}
        </div>
        <div className="flex gap-3">
          <PillButton 
            variant="ghost" 
            onClick={() => handleDecision("reject")}
            className="text-danger hover:text-danger hover:border-danger"
          >
            Reject
          </PillButton>
          <PillButton 
            variant="ghost" 
            onClick={() => handleDecision("edit")}
            className="text-warn hover:text-warn hover:border-warn"
          >
            Edit
          </PillButton>
          <PillButton 
            variant="primary" 
            onClick={() => handleDecision("approve")}
            className="bg-success text-bg-deep border-success hover:bg-success/90 hover:border-success/90"
          >
            Approve
          </PillButton>
        </div>
      </div>
    </div>
  );
}
