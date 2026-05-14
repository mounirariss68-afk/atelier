import { useState } from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { useRoute } from "wouter";
import { Calendar, FileText, Users, Mic, Eye } from "lucide-react";
import {
  useEditorialCalendar,
  useInFlightContent,
  usePartnerCadence,
  useNewsletter,
  useSpeakingOpportunities,
  usePressMentions,
} from "@/lib/v5-hooks";

const SUB_ROUTES = [
  { id: "calendar", label: "Editorial Calendar" },
  { id: "in-flight", label: "In Flight" },
  { id: "linkedin", label: "Partner Cadence" },
  { id: "newsletter", label: "Field Notes" },
  { id: "speaking", label: "Speaking" },
  { id: "mentions", label: "Press Register" },
];

export default function PressIndex() {
  const [, params] = useRoute("/press/:section");
  const section = params?.section ?? "calendar";

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead
          eyebrow="The Press"
          headline="Thought leadership at firm cadence"
          lede="Editorial calendar, in-flight pieces, Partner posting voice, the Field Notes newsletter, speaking opportunities, and the press-mention register — all tied back to Synthesis-Critic-cleared Atelier artifacts so nothing public ships uncited."
        />
      </PageHero>
      <div className="container-atelier py-6">
        <TabNav>
          {SUB_ROUTES.map((r) => (
            <TabNavLink
              key={r.id}
              href={`/press/${r.id}`}
              active={section === r.id}
            >
              {r.label}
            </TabNavLink>
          ))}
        </TabNav>

        <div className="mt-8">
          {section === "calendar" && <CalendarView />}
          {section === "in-flight" && <InFlightView />}
          {section === "linkedin" && <LinkedinView />}
          {section === "newsletter" && <NewsletterView />}
          {section === "speaking" && <SpeakingView />}
          {section === "mentions" && <MentionsView />}
        </div>
      </div>
    </div>
  );
}

function CalendarView() {
  const EDITORIAL_CALENDAR = useEditorialCalendar();
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-mute flex items-center gap-2">
        <Calendar className="w-4 h-4" />
        12 weeks ahead. Slots are seeded by the Theme Curator promoting
        high-confidence themes into Press as POV candidates.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {EDITORIAL_CALENDAR.map((s) => (
          <Card key={s.id} className="p-4 space-y-2 border-l-4 border-l-gold">
            <div className="flex items-center justify-between">
              <div className="font-medium text-text">{s.workingTitle}</div>
              <MonoChip tone={s.status === "scheduled" ? "gold" : s.status === "drafting" ? "amber" : "default"}>
                {s.status}
              </MonoChip>
            </div>
            <div className="flex gap-1 flex-wrap text-xs">
              <MonoChip>{s.publication}</MonoChip>
              <MonoChip>{s.byline}</MonoChip>
              <MonoChip>{s.publishOn}</MonoChip>
            </div>
            <p className="text-sm text-text-mute">{s.thesis}</p>
            {s.themeId && (
              <div className="text-xs text-text-faint">
                Promoted from theme: <span className="text-gold">{s.themeId}</span>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function InFlightView() {
  const IN_FLIGHT_CONTENT = useInFlightContent();
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-mute flex items-center gap-2">
        <FileText className="w-4 h-4" />
        Pieces between outline and ship. Each is bound to its source Atelier
        artifact and carries a citation-coverage score.
      </p>
      <div className="space-y-2">
        {IN_FLIGHT_CONTENT.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="font-medium text-text">{c.title}</div>
                <div className="text-xs text-text-faint mt-1">
                  {c.kind} · {c.byline} · {c.wordCount} words · sourced from {c.sourceArtifact}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <MonoChip tone={c.phase === "stylist" ? "green" : c.phase === "section_writer" ? "amber" : "default"}>
                  {c.phase}
                </MonoChip>
                <MonoChip tone={c.citationCoverage >= 0.8 ? "green" : "red"}>
                  cite {Math.round(c.citationCoverage * 100)}%
                </MonoChip>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function LinkedinView() {
  const PARTNER_POSTING_CADENCE = usePartnerCadence();
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-mute flex items-center gap-2">
        <Users className="w-4 h-4" />
        Each Partner has a voice profile in <Link href="/atelier/prompts" className="text-gold hover:underline">/atelier/prompts</Link>.
        LinkedIn Composer drafts in voice; Partner approves before send.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {PARTNER_POSTING_CADENCE.map((p) => (
          <Card key={p.partnerId} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-text">{p.partnerName}</div>
                <div className="text-xs text-text-faint">{p.voiceProfile}</div>
              </div>
              <MonoChip tone={p.cadenceMet ? "green" : "amber"}>
                {p.postsThis90d}/{p.targetPer90d} in 90d
              </MonoChip>
            </div>
            <div className="space-y-2">
              {p.queue.map((q) => (
                <div key={q.id} className="text-sm border-l-2 border-l-border pl-3">
                  <div className="text-text">{q.draftBody}</div>
                  <div className="text-xs text-text-faint mt-1">
                    {q.status} · voice match {q.voiceMatchScore}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function NewsletterView() {
  const NEWSLETTER_SUBSCRIBERS = useNewsletter();
  if (!NEWSLETTER_SUBSCRIBERS) {
    return (
      <div className="text-sm text-text-faint">Loading newsletter…</div>
    );
  }
  const issue = NEWSLETTER_SUBSCRIBERS.currentIssue;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs text-text-faint">Subscribers</div>
          <div className="text-2xl font-mono text-text mt-1">{NEWSLETTER_SUBSCRIBERS.totalSubscribers.toLocaleString()}</div>
          <div className="text-xs text-text-mute mt-1">+{NEWSLETTER_SUBSCRIBERS.netGrowthLast90d} last 90d</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-text-faint">Open rate · last 6 issues</div>
          <div className="text-2xl font-mono text-text mt-1">{Math.round(NEWSLETTER_SUBSCRIBERS.avgOpenRate * 100)}%</div>
          <div className="text-xs text-text-mute mt-1">benchmark 22%</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-text-faint">Click rate</div>
          <div className="text-2xl font-mono text-text mt-1">{Math.round(NEWSLETTER_SUBSCRIBERS.avgClickRate * 100)}%</div>
          <div className="text-xs text-text-mute mt-1">benchmark 2.4%</div>
        </Card>
      </div>
      {issue && (
        <Card className="p-4 space-y-3 border-l-4 border-l-gold">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-text-faint">Field Notes — issue assembling</div>
              <div className="font-medium text-text">{issue.subjectLine}</div>
            </div>
            <MonoChip tone="amber">{issue.status}</MonoChip>
          </div>
          <div className="text-xs text-text-faint">scheduled send {issue.scheduledSendAt}</div>
          <div className="space-y-1 text-sm">
            {issue.sections.map((s) => (
              <div key={s.id} className="flex justify-between">
                <span className="text-text-mute">{s.label}</span>
                <span className="text-text">{s.summary}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function SpeakingView() {
  const SPEAKING_OPPORTUNITIES = useSpeakingOpportunities();
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-mute flex items-center gap-2">
        <Mic className="w-4 h-4" />
        Inbound and inferred opportunities. Press Monitor surfaces conferences
        and podcast queries during the daily scan.
      </p>
      {SPEAKING_OPPORTUNITIES.map((o) => (
        <Card key={o.id} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="font-medium text-text">{o.event}</div>
              <div className="text-xs text-text-faint mt-1">
                {o.kind} · {o.location} · {o.date} · target audience: {o.audience}
              </div>
              <div className="text-sm text-text mt-2">Ask: {o.ask}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <MonoChip tone={o.decision === "accepted" ? "green" : o.decision === "declined" ? "default" : "amber"}>
                {o.decision}
              </MonoChip>
              <span className="text-xs text-text-faint">owner: {o.owner}</span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function MentionsView() {
  const PRESS_MENTIONS = usePressMentions();
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-mute flex items-center gap-2">
        <Eye className="w-4 h-4" />
        Press Monitor agent · last 30 days. Sentiment classified per mention,
        competitor coverage clustered into themes.
      </p>
      {PRESS_MENTIONS.map((m) => (
        <Card key={m.id} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="font-medium text-text">{m.headline}</div>
              <div className="text-xs text-text-faint mt-1">
                {m.publication} · {m.date} · {m.about}
              </div>
              <div className="text-sm text-text-mute mt-2">{m.summary}</div>
            </div>
            <MonoChip
              tone={
                m.sentiment === "positive" ? "green" :
                m.sentiment === "critical" ? "red" :
                m.sentiment === "negative" ? "amber" : "default"
              }
            >
              {m.sentiment}
            </MonoChip>
          </div>
        </Card>
      ))}
    </div>
  );
}
