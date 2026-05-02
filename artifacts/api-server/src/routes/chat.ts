import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { ChatBody } from "@workspace/api-zod";
import {
  knowledgeBase,
  buildKnownLinks,
  type KnownLink,
} from "@workspace/maven-content";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------- in-memory rate limiter (per-IP, sliding window) ----------
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const rateBuckets = new Map<string, number[]>();

function rateLimitOk(ip: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = (rateBuckets.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (bucket.length >= RATE_LIMIT_MAX) {
    const oldest = bucket[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000));
    rateBuckets.set(ip, bucket);
    return { ok: false, retryAfterSeconds };
  }
  bucket.push(now);
  rateBuckets.set(ip, bucket);
  return { ok: true };
}

// Periodic cleanup so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    const fresh = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (fresh.length === 0) rateBuckets.delete(ip);
    else rateBuckets.set(ip, fresh);
  }
}, RATE_LIMIT_WINDOW_MS).unref?.();

// ---------- prompt construction ----------
const KNOWN_LINKS: KnownLink[] = buildKnownLinks();
const KNOWN_LINK_LIST = KNOWN_LINKS
  .map((l) => `- ${l.kind}: ${l.href}  (${l.label})`)
  .join("\n");

function buildSystemPrompt(language: "en" | "ar"): string {
  const kb = knowledgeBase;
  const services = kb.services
    .map((s) => `* ${s.title} (slug: ${s.slug}) — buyer: ${s.buyer}. ${s.summary}`)
    .join("\n");
  const industries = kb.industries.map((i) => `* ${i.title} (id: ${i.id}) — ${i.subtitle}`).join("\n");
  const insights = kb.insights
    .map((i) => `* [${i.type} · ${i.category}] "${i.title}" (slug: ${i.slug}) — ${i.summary}`)
    .join("\n");
  const assessments = kb.assessments
    .map((a) => `* ${a.code} — ${a.name} (slug: ${a.slug}, ~${a.estMinutes} min) — ${a.summary}`)
    .join("\n");
  const founders = kb.founders.map((f) => `* ${f.name}, ${f.title} (${f.location}) — ${f.summary}`).join("\n");

  const langNote =
    language === "ar"
      ? "Respond in modern standard Arabic (فصحى) unless the user writes in English. Keep proper nouns and slugs in Latin script."
      : "Respond in English unless the user writes in Arabic.";

  return `You are the Maven AI website assistant — a calm, partner-grade voice answering questions for executives and founders considering Maven AI.

ABOUT MAVEN AI
${kb.firmFacts.positioning}
Offices: ${kb.firmFacts.offices}
Promise: ${kb.firmFacts.promise}
Pricing: ${kb.firmFacts.pricing}
Contact: ${kb.firmFacts.contact}

SERVICES
${services}

INDUSTRIES
${industries}

INSIGHTS (research, perspectives, opinion, briefs)
${insights}

DIAGNOSTIC ASSESSMENTS
${assessments}

FOUNDERS (only on the /about page — there is no /founders page)
${founders}

RULES
1. Ground every answer in the knowledge above. If the user asks something this knowledge does not cover (e.g. specific delivered case studies, pricing in dollars, named clients), say so honestly and suggest they book a 30-minute partner readout.
2. Never invent service names, slugs, report titles, founder names, statistics, or client names.
3. When you reference a specific Maven AI artefact (a service, insight report, assessment, or industry profile), cite it inline by its exact title in plain text — for example: "Our Agentic AI Transformation service…" or "See our report The Agentic Enterprise: From Pilot to Production." Do NOT use markdown link syntax — the suggestion cards below the answer carry the clickable links.
4. Tone: senior, candid, McKinsey-grade. No emojis. No fluff. 2–4 short paragraphs maximum.
5. ${langNote}
6. End every response with a single line in this exact format on its own line, nothing after it:
   <<<SUGGESTIONS>>>{"items":[{"kind":"<kind>","href":"<href>","label":"<label>"}]}<<<END>>>
   Up to three items, drawn ONLY from this allow-list of known site links:
${KNOWN_LINK_LIST}
   When the user shows clear buying intent ("how do I engage you", "talk to a partner", "get a proposal", pricing/scope questions), prefer the matching \`/contact?topic=<service-slug>\` CTA so the contact form is pre-filled.
   If no link is genuinely relevant, output \`<<<SUGGESTIONS>>>{"items":[]}<<<END>>>\`.
7. Output everything else as plain text. No markdown headings, no asterisks, no bullet characters, no markdown link syntax \`[text](url)\`.`;
}

// ---------- SSE helpers ----------
function sseWrite(res: Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

interface ParsedSuggestions {
  visibleText: string;
  suggestions: Array<{ kind: string; href: string; label: string }>;
}

function extractSuggestions(fullText: string): ParsedSuggestions {
  const match = fullText.match(/<<<SUGGESTIONS>>>([\s\S]*?)<<<END>>>/);
  if (!match) return { visibleText: fullText.trim(), suggestions: [] };
  const visibleText = (fullText.slice(0, match.index) + fullText.slice((match.index ?? 0) + match[0].length)).trim();
  try {
    const parsed = JSON.parse(match[1]);
    if (Array.isArray(parsed?.items)) {
      const allowed = new Set(KNOWN_LINKS.map((l) => l.href));
      const items = (parsed.items as unknown[])
        .filter((i): i is { kind: string; href: string; label: string } =>
          !!i && typeof i === "object" && typeof (i as { href?: unknown }).href === "string",
        )
        .filter((i) => allowed.has(i.href))
        .slice(0, 3);
      return { visibleText, suggestions: items };
    }
  } catch (err) {
    logger.warn({ err }, "Could not parse chat suggestions JSON");
  }
  return { visibleText, suggestions: [] };
}

// ---------- AI streaming with provider fallback ----------
async function streamFromAnthropic(
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
  onToken: (token: string) => void,
): Promise<{ fullText: string } | null> {
  const baseURL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
  if (!baseURL || !apiKey) return null;

  const anth = new Anthropic({ baseURL, apiKey });
  const stream = anth.messages.stream({
    model: "claude-sonnet-4-5",
    max_tokens: 1200,
    system: systemPrompt,
    messages,
  });

  let fullText = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      const t = event.delta.text;
      fullText += t;
      onToken(t);
    }
  }
  return { fullText };
}

async function streamFromOpenAI(
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string }[],
  onToken: (token: string) => void,
): Promise<{ fullText: string } | null> {
  const baseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  if (!baseURL || !apiKey) return null;

  const oa = new OpenAI({ baseURL, apiKey });
  const stream = await oa.chat.completions.create({
    model: "gpt-5",
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  });

  let fullText = "";
  for await (const chunk of stream) {
    const t = chunk.choices?.[0]?.delta?.content;
    if (typeof t === "string" && t.length > 0) {
      fullText += t;
      onToken(t);
    }
  }
  return { fullText };
}

// ---------- streaming token filter ----------
// Two responsibilities:
//   1. The SUGGESTIONS marker must never leak to the client (held back in
//      flight using a tail buffer so the marker is detected even when split
//      across provider chunks).
//   2. Defense in depth against allow-list bypass via inline markdown links:
//      strip `[label](url)` syntax from outgoing tokens, leaving just the
//      label. Suggestions still flow through the validated allow-list path.
function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\((?:https?:[^)\s]+|\/[^)\s]*)\)/g, "$1");
}

function makeTokenFilter(onSafe: (text: string) => void) {
  let buffer = "";
  const MARKER = "<<<SUGGESTIONS>>>";
  // Hold back enough tail to cover an in-progress marker OR an in-progress
  // markdown link (which can be longer than the marker for long URLs).
  const TAIL = Math.max(MARKER.length - 1, 256);
  return {
    push(t: string) {
      buffer += t;
      const idx = buffer.indexOf(MARKER);
      if (idx !== -1) {
        const safe = stripMarkdownLinks(buffer.slice(0, idx));
        if (safe) onSafe(safe);
        buffer = buffer.slice(idx); // hold from marker onwards; flush() will discard
        return;
      }
      if (buffer.length > TAIL) {
        const safe = stripMarkdownLinks(buffer.slice(0, buffer.length - TAIL));
        buffer = buffer.slice(buffer.length - TAIL);
        if (safe) onSafe(safe);
      }
    },
    flush() {
      if (buffer.indexOf(MARKER) === -1 && buffer.length > 0) {
        onSafe(stripMarkdownLinks(buffer));
      }
      buffer = "";
    },
  };
}

router.post("/", async (req: Request, res: Response) => {
  const ip = (req.ip || req.socket.remoteAddress || "unknown").toString();
  const rl = rateLimitOk(ip);
  if (!rl.ok) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60);
    res.status(429).json({
      error: `You've hit the chat limit for now — please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}, or book a 30-minute readout from the Contact page.`,
      retryAfterSeconds: rl.retryAfterSeconds,
    });
    return;
  }

  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid chat request" });
    return;
  }
  const language = parsed.data.language ?? "en";
  const messages = parsed.data.messages;

  // Open SSE stream.
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // SSE comment heartbeat — keeps proxies/load balancers from dropping the
  // connection during long model responses. Cleared in finally below.
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      // socket closed
    }
  }, 15_000);
  heartbeat.unref?.();

  // Stop streaming work if the client disconnects mid-flight. Use `res` for
  // detection — `res.on("close")` fires on socket close and only matters as
  // an abort signal while we're still streaming (i.e. before res.end()).
  let clientAborted = false;
  res.on("close", () => {
    if (!res.writableEnded) clientAborted = true;
  });

  const systemPrompt = buildSystemPrompt(language);

  const filter = makeTokenFilter((safe) => {
    sseWrite(res, { type: "token", token: safe });
  });

  const startedAt = Date.now();
  let fullText = "";
  let provider: "anthropic" | "openai" | "fallback" = "anthropic";

  try {
    const onTok = (t: string) => {
      if (!clientAborted) filter.push(t);
    };

    const anthResult = await streamFromAnthropic(systemPrompt, messages, onTok).catch((err) => {
      logger.warn({ err }, "Chat: Anthropic stream failed; falling back");
      return null;
    });

    if (anthResult) {
      fullText = anthResult.fullText;
    } else {
      provider = "openai";
      const oaResult = await streamFromOpenAI(systemPrompt, messages, onTok).catch((err) => {
        logger.warn({ err }, "Chat: OpenAI stream failed");
        return null;
      });
      if (oaResult) {
        fullText = oaResult.fullText;
      } else {
        provider = "fallback";
        fullText = templateFallback(language, messages[messages.length - 1]?.content ?? "");
        onTok(fullText);
      }
    }

    filter.flush();
    const { suggestions } = extractSuggestions(fullText);

    if (!res.writableEnded) {
      sseWrite(res, { type: "done", suggestions });
      res.end();
    }
    // No raw user text logged. We emit suggestion hrefs (allow-listed),
    // a coarse length bucket, and a truncated sha256 of the question for
    // grouping repeats in analytics.
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const normalized = lastUser.replace(/\s+/g, " ").trim().toLowerCase();
    const questionLengthBucket =
      normalized.length === 0 ? "empty"
      : normalized.length < 40 ? "xs"
      : normalized.length < 120 ? "s"
      : normalized.length < 400 ? "m"
      : normalized.length < 800 ? "l"
      : "xl";
    const questionHash =
      normalized.length > 0
        ? createHash("sha256").update(normalized).digest("hex").slice(0, 16)
        : null;
    logger.info(
      {
        provider,
        durationMs: Date.now() - startedAt,
        msgCount: messages.length,
        replyChars: fullText.length,
        suggestionCount: suggestions.length,
        suggestionHrefs: suggestions.map((s) => s.href),
        questionLengthBucket,
        questionHash,
        lang: language,
        clientAborted,
      },
      "Chat reply complete",
    );
  } catch (err) {
    logger.error({ err }, "Chat stream error");
    try {
      sseWrite(res, { type: "error", message: "The assistant is unavailable right now." });
      res.end();
    } catch {
      // already closed
    }
  } finally {
    clearInterval(heartbeat);
  }
});

function templateFallback(language: "en" | "ar", lastUserText: string): string {
  const en = `Thanks for the question. Our assistant is briefly unavailable, but here's the short version: Maven AI is a boutique GCC AI advisory and engineering firm focused on closing the gap between AI ambition and production. Based on what you asked ("${lastUserText.slice(0, 80)}"), the most useful next step is probably to look at our services and assessments, or book a 30-minute partner readout.\n<<<SUGGESTIONS>>>${JSON.stringify({
    items: [
      { kind: "page", href: "/services", label: "Our services" },
      { kind: "page", href: "/assessments", label: "Run a diagnostic" },
      { kind: "page", href: "/contact", label: "Book a 30-minute readout" },
    ],
  })}<<<END>>>`;
  const ar = `شكراً على سؤالكم. المساعد غير متاح لحظياً، لكن باختصار: Maven AI شركة استشارات وهندسة ذكاء اصطناعي بوتيك في الخليج، تركز على سدّ الفجوة بين طموح الذكاء الاصطناعي والإنتاج الفعلي. بناءً على ما سألتم عنه، الخطوة الأفضل هي الاطلاع على خدماتنا أو حجز قراءة شراكة لمدة 30 دقيقة.\n<<<SUGGESTIONS>>>${JSON.stringify({
    items: [
      { kind: "page", href: "/services", label: "خدماتنا" },
      { kind: "page", href: "/assessments", label: "تشخيص" },
      { kind: "page", href: "/contact", label: "احجز قراءة 30 دقيقة" },
    ],
  })}<<<END>>>`;
  return language === "ar" ? ar : en;
}

export default router;
