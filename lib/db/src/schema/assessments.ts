import {
  pgTable,
  text,
  serial,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const assessmentSubmissionsTable = pgTable(
  "assessment_submissions",
  {
    id: serial("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    slug: text("slug").notNull(),
    overallScore: doublePrecision("overall_score").notNull(),
    tier: text("tier").notNull(),
    sovereignScore: doublePrecision("sovereign_score").notNull().default(0),
    language: text("language").notNull().default("en"),
    profile: jsonb("profile").notNull(),
    answers: jsonb("answers").notNull(),
    useCases: jsonb("use_cases"),
    result: jsonb("result").notNull(),
    memo: text("memo"),
    teamToken: text("team_token"),
    teamRole: text("team_role"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_assessment_team_token").on(t.teamToken),
    index("idx_assessment_slug").on(t.slug),
  ],
);

export const insertAssessmentSubmissionSchema = createInsertSchema(
  assessmentSubmissionsTable,
).omit({ id: true, createdAt: true });
export type InsertAssessmentSubmission = z.infer<typeof insertAssessmentSubmissionSchema>;
export type AssessmentSubmission = typeof assessmentSubmissionsTable.$inferSelect;

export const callRequestsTable = pgTable("call_requests", {
  id: serial("id").primaryKey(),
  submissionPublicId: text("submission_public_id"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company").notNull(),
  role: text("role"),
  preferredTime: text("preferred_time"),
  message: text("message"),
  language: text("language").notNull().default("en"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCallRequestSchema = createInsertSchema(callRequestsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCallRequest = z.infer<typeof insertCallRequestSchema>;
export type CallRequest = typeof callRequestsTable.$inferSelect;

export const teamInvitationsTable = pgTable(
  "team_invitations",
  {
    id: serial("id").primaryKey(),
    teamToken: text("team_token").notNull().unique(),
    slug: text("slug").notNull(),
    initiatorName: text("initiator_name").notNull(),
    initiatorEmail: text("initiator_email").notNull(),
    company: text("company").notNull(),
    seats: integer("seats").notNull().default(10),
    expiresAt: timestamp("expires_at"),
    closed: boolean("closed").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_team_invitations_token").on(t.teamToken)],
);

export const insertTeamInvitationSchema = createInsertSchema(teamInvitationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTeamInvitation = z.infer<typeof insertTeamInvitationSchema>;
export type TeamInvitation = typeof teamInvitationsTable.$inferSelect;
