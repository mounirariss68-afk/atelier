import { useRoute } from "wouter";
import { TabNav, TabNavLink } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import {
  RolesView, CandidatesView, InterviewsView, ReferencesView, OffersView,
} from "@/pages/studio/StudioIndex";

const SUBS = [
  { id: "roles",       label: "Open Roles" },
  { id: "candidates",  label: "Candidate CRM" },
  { id: "interviews",  label: "Panels & Scorecards" },
  { id: "references",  label: "References" },
  { id: "offers",      label: "Offers" },
  { id: "take-homes",  label: "Take-homes" },
];

export default function PeopleHire() {
  const [, params] = useRoute("/people/hire/:section");
  const section = params?.section ?? "roles";

  return (
    <PeopleShell stage="hire">
      <LensPageHeader
        headline="Talent funnel · sourced → offered, structured"
        lede="Candidate CRM in the same shape as the client CRM. Pursuit Scout sources; Interview Designer drafts the panel + scorecard; Reference Caller produces structured summaries; Offer Composer drafts the letter."
      />
      <div className="container-atelier py-6">
        <TabNav>
          {SUBS.map((s) => (
            <TabNavLink key={s.id} href={`/people/hire/${s.id}`} active={section === s.id}>
              {s.label}
            </TabNavLink>
          ))}
        </TabNav>
        <div className="mt-8">
          {section === "roles" && <RolesView />}
          {section === "candidates" && <CandidatesView />}
          {section === "interviews" && <InterviewsView />}
          {section === "references" && <ReferencesView />}
          {section === "offers" && <OffersView />}
          {section === "take-homes" && <TakeHomesView />}
        </div>
      </div>
    </PeopleShell>
  );
}

function TakeHomesView() {
  return (
    <div className="rounded border border-dashed border-border bg-bg-elevate/40 p-6 text-sm text-text-mute">
      Take-homes are bound per role on the Open Roles tab. Submissions land here once candidates submit.
    </div>
  );
}
