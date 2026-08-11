/**
 * Task #939 — `find_screen`: teach Riser the app's screens so it can
 * answer "where do I find X?" and take the user there.
 *
 * Read-only capability over the shared @workspace/screen-catalog package
 * (GENERATED from the web app's real nav definitions — see the drift
 * guard `test:screen-catalog` in artifacts/atelier). Matching is
 * deterministic lexical scoring (offline-testable, no LLM/embeddings);
 * persona filtering rides the catalog's per-screen role lists, so a
 * self-only employee only ever hears about Me-lens screens and an
 * alliance partner only about the partner portal.
 *
 * Reads MAY return `navigateTo` (the contract wrapper only enforces
 * writes) — existing precedent: account.dossier. Parameterized
 * workspace screens (need a record id) return `navigateTo: null` and a
 * location description instead, so mobile never gets a dead link
 * (mobile additionally maps hrefs via internalRouteFor and renders
 * unmapped ones non-pressable).
 */
import {
  screensForRole,
  matchScreens,
  hasMobileScreen,
  type ScreenEntry,
} from "@workspace/screen-catalog";
import {
  defineCapability,
  CATALOG_SCHEMA_VERSION,
} from "./capability-catalog.js";

function locationOf(s: ScreenEntry): string {
  return s.breadcrumb.join(" → ");
}

defineCapability({
  id: "meta.find_screen",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "find_screen",
  description:
    "Find where something lives in the app. Use for 'where do I see/find …?', 'how do I get to …?', 'which page shows …?' — including right after a write ('where do I see the expense I just added?'). Returns the screen name, its location breadcrumb and, when the screen has a direct URL, a link that opens it.",
  slashAliases: { en: ["/where", "/find-screen"] },
  representativePrompts: {
    en: ["Where do I find my payslips?", "Where do I see the pipeline?"],
    ar: ["أين أجد كشوف راتبي؟"],
    fr: ["Où puis-je trouver mes fiches de paie ?"],
  },
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "What the user is looking for, in plain words (e.g. 'payslips', 'the expense I just added', 'pipeline').",
      },
    },
    required: ["query"],
  },
  isWrite: false,
  irreversible: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  surfaceOn: ["global", "home"],
  examplePhrases: {
    en: [
      "Where do I find my payslips?",
      "Where do I see my expense claims?",
      "Which page shows the sales pipeline?",
    ],
    ar: ["أين أجد كشوف راتبي؟"],
    fr: ["Où puis-je voir mes notes de frais ?"],
  },
  run: async (input, ctx) => {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    const screens = screensForRole(ctx.persona.role);

    if (!query) {
      return {
        ok: false,
        error: {
          code: "missing_query",
          message: "Tell me what you're looking for and I'll point you to the right screen.",
        },
      };
    }

    const matches = matchScreens(query, screens);
    if (matches.length === 0) {
      // Persona-safe by construction: we only ever searched this role's
      // slice, so "not found" never confirms an out-of-perimeter screen.
      return {
        ok: true,
        data: {
          title: "No matching screen",
          note: `I couldn't find a screen matching "${query}" in the parts of the app you can see. Try different words, or tell me what you're trying to do.`,
          navigateTo: null,
        },
      };
    }

    const best = matches[0].screen;
    const alternates = matches
      .slice(1, 4)
      // Only meaningfully-close alternates; drop the long lexical tail.
      .filter((m) => m.score >= matches[0].score * 0.5)
      .map((m) => `${m.screen.title} (${locationOf(m.screen)})`);

    const direct = !best.parameterized;
    return {
      ok: true,
      data: {
        title: best.title,
        location: locationOf(best),
        note: best.parameterized
          ? `${best.description} Open the parent list first, then pick the record — there's no single page to link to.`
          : best.description,
        href: direct ? best.path : null,
        mobile: direct && hasMobileScreen(best.path)
          ? "Also available in the mobile app"
          : null,
        alsoConsider: alternates.length > 0 ? alternates.join("; ") : null,
        navigateTo: direct
          ? { path: best.path, when: "on_commit" as const }
          : null,
      },
    };
  },
});
