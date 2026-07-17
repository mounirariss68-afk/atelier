// Shared hard-delete for opportunities.
//
// Meetings and transcripts hang off a polymorphic parent
// (parent_type/parent_id), so no database foreign key can cascade them when
// an opportunity row is physically removed. Win/Loss debriefs and Pane A
// dashboard items are similarly created by side-effect hooks and reference
// the opportunity by id. Any code path that hard-deletes an opportunity MUST
// go through this helper so those children are swept in the same pass —
// otherwise orphan rows surface in broad reads (weekly-pulse meeting scans,
// CLI entity resolution, dashboards).
//
// Other opportunity children (transitions, briefs, facts, povs, proposals,
// deal pricings) cascade via real FKs; engagements/prototypes detach via
// SET NULL. Soft delete (deletedAt) does NOT need this — reads already
// filter on isNull(deletedAt).
import {
  db as defaultDb,
  atelierMeetings,
  atelierTranscripts,
  atelierOpportunities,
  atelierWinLossDebriefs,
  atelierPaneAItems,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

type Db = typeof defaultDb;

/**
 * Hard-deletes the given opportunities plus every non-FK child that would
 * otherwise be orphaned (opp-parented meetings, their transcripts, win/loss
 * debriefs, opportunity-targeted Pane A items).
 */
export async function hardDeleteOpportunities(
  oppIds: string[],
  dbc: Db = defaultDb,
): Promise<void> {
  const ids = [...new Set(oppIds)].filter(Boolean);
  if (ids.length === 0) return;

  const oppMeetings = await dbc
    .select({ id: atelierMeetings.id, transcriptId: atelierMeetings.transcriptId })
    .from(atelierMeetings)
    .where(and(eq(atelierMeetings.parentType, "opportunity"), inArray(atelierMeetings.parentId, ids)));

  const meetingIds = oppMeetings.map((m) => m.id);
  const transcriptIds = oppMeetings
    .map((m) => m.transcriptId)
    .filter((t): t is string => Boolean(t));

  if (meetingIds.length)
    await dbc.delete(atelierMeetings).where(inArray(atelierMeetings.id, meetingIds));
  if (transcriptIds.length)
    await dbc.delete(atelierTranscripts).where(inArray(atelierTranscripts.id, transcriptIds));

  await dbc.delete(atelierWinLossDebriefs).where(inArray(atelierWinLossDebriefs.opportunityId, ids));
  await dbc
    .delete(atelierPaneAItems)
    .where(and(eq(atelierPaneAItems.hrefKind, "opportunity"), inArray(atelierPaneAItems.hrefTargetId, ids)));

  await dbc.delete(atelierOpportunities).where(inArray(atelierOpportunities.id, ids));
}

/** Convenience single-id wrapper around {@link hardDeleteOpportunities}. */
export async function hardDeleteOpportunity(oppId: string, dbc: Db = defaultDb): Promise<void> {
  await hardDeleteOpportunities([oppId], dbc);
}
