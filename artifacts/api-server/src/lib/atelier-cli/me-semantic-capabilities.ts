/**
 * Task #1413 — a selector-free composition of the existing Me read lens.
 *
 * This intentionally contains no person queries or domain read models. Each
 * section delegates to the already-authorized `my_*` capability, so identity,
 * worker type, lifecycle, and sensitive-field policy remain owned by those
 * capabilities.
 */
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
  findByToolName,
} from "./capability-catalog.js";
import type { ToolContext, ToolResult } from "./index.js";

const SECTION_TO_TOOL = {
  profile: "my_profile",
  leave: "my_leave",
  learning: "my_learning",
  reviews: "my_reviews",
  goals: "my_goals",
  expenses: "my_expenses",
  timesheets: "my_timesheets",
  tasks: "my_tasks",
  documents: "my_documents",
} as const;

type Section = keyof typeof SECTION_TO_TOOL;
const SECTION_NAMES = Object.keys(SECTION_TO_TOOL) as Section[];

const inputSchema = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: { type: "string", enum: SECTION_NAMES },
      minItems: 1,
      maxItems: 9,
      uniqueItems: true,
      description: "Optional Me sections to include. Defaults to all sections.",
    },
  },
  additionalProperties: false,
} as Record<string, unknown>;

function invalidInput(message: string): ToolResult {
  return { ok: false, errorCode: "invalid_input", errorMessage: message };
}

function requestedSections(input: Record<string, unknown>): Section[] | ToolResult {
  const unknown = Object.keys(input).filter((key) => key !== "sections");
  if (unknown.length > 0) {
    return invalidInput(`This lens does not accept selectors or unknown fields: ${unknown.join(", ")}.`);
  }
  if (input.sections === undefined) return [...SECTION_NAMES];
  if (!Array.isArray(input.sections) || input.sections.length < 1 || input.sections.length > 9) {
    return invalidInput("sections must contain between 1 and 9 Me section names.");
  }
  if (input.sections.some((section) => typeof section !== "string" || !SECTION_NAMES.includes(section as Section))) {
    return invalidInput("sections contains an unsupported Me section.");
  }
  if (new Set(input.sections).size !== input.sections.length) {
    return invalidInput("sections must not contain duplicates.");
  }
  return input.sections as Section[];
}

function sectionError(result: ToolResult) {
  return {
    available: false,
    errorCode: result.errorCode ?? "unavailable",
    errorMessage: result.errorMessage ?? "This Me section is unavailable.",
  };
}

defineCapability({
  id: "me.semantic_summary",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "roster",
  toolName: "my_semantic_summary",
  description:
    "Compose selected self-only Me sections from the existing profile, leave, learning, performance, expense, timesheet, task, and personal-document read lenses.",
  slashAliases: { en: ["/my-summary", "/me-summary"] },
  representativePrompts: {
    en: ["Summarize my current Me information", "Show my profile, leave, learning, and work sections"],
  },
  inputSchema,
  isWrite: false,
  irreversible: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "section_card",
  surfaceOn: ["home", "global"],
  promoteAsSuggestion: false,
  async run(input, ctx): Promise<ToolResult> {
    const sections = requestedSections(input);
    if (!Array.isArray(sections)) return sections;

    const composed = await Promise.all(sections.map(async (section) => {
      const toolName = SECTION_TO_TOOL[section];
      const capability = findByToolName(toolName);
      if (!capability) {
        return [section, {
          available: false,
          errorCode: "section_unavailable",
          errorMessage: "The underlying Me section is not available.",
        }] as const;
      }
      // Deliberately pass no input. Existing executors resolve the subject
      // from ctx.persona and retain their own worker/audience/field gates.
      const result = await capability.run({}, ctx as ToolContext);
      return [section, result.ok ? {
        available: true,
        data: result.data,
      } : sectionError(result)] as const;
    }));

    return {
      ok: true,
      data: {
        shape: "me_semantic_summary",
        selfScoped: true,
        sections: Object.fromEntries(composed),
      },
    };
  },
});