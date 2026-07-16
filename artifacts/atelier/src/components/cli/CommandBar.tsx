/**
 * Task #333 — Atelier CLI Cmd+K command bar.
 *
 * One component, all states. Composer at the bottom, transcript above,
 * /help drawer + saved-prompt drawer slide in over the transcript.
 *
 * Keyboard model:
 *   ⌘K / Ctrl+K — open (handled in Shell.tsx via window listener)
 *   Esc        — close, focus restored to the trigger
 *   Enter      — submit
 *   Shift+Enter — newline
 *   ↑          — recall last prompt (from cursor at the start of empty composer)
 *   ⌘↩ / Ctrl+↩ — confirm a pending plan
 *   /          — opens slash menu (filter by typed token after the slash)
 *
 * A11y:
 *   - role="dialog" aria-modal="true" with focus trap when open
 *   - transcript: role="log" aria-live="polite" so SR doesn't read every token
 *   - prefers-reduced-motion: removes the streaming pulse
 *   - data-testid stable on every state for end-to-end tests
 *   - RTL mirroring: `dir="rtl"` on the panel root when locale is `ar`
 */

import * as React from "react";
import { useState } from "react";
import { useLocation } from "wouter";
import {
  X,
  Send,
  Paperclip,
  Sparkles,
  HelpCircle,
  Bookmark,
  Languages,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Clock,
  Copy,
  ExternalLink,
  XCircle,
  RotateCcw,
  Trash2,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCli, isSafeHttpUrl } from "./useCli";
import { CliContext } from "./cli-context";
import { useAutoNavEnabled } from "./autoNav";
import { toast as showToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { s, sFmt, localeInstruction } from "./locale";
import { derivePageContext, suggestionsFor, homeSuggestionsFor } from "./pageContext";
import { useAtelierGetMe } from "@workspace/api-client-react";
import {
  addSavedPrompt,
  deleteSavedPrompt,
  listSavedPrompts,
  type SavedPrompt,
} from "./savedPrompts";
import { emitCliOpened } from "./telemetry";
import type { CliCapability, CliClarification, CliLocale, CliTurn } from "./types";
import { ToolResultCardList } from "./ResultCardRenderers";
import { Markdown } from "./Markdown";

const MAX_INPUT_CHARS = 4000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export interface CommandBarProps {
  open?: boolean;
  onClose?: () => void;
  /** Element to restore focus to on close (typically the top-nav button). */
  triggerRef?: React.RefObject<HTMLElement | null>;
  /**
   * Task #501 — when true, the bar renders inline inside its parent
   * container (e.g. the right-rail Agent tab) instead of as a fixed
   * centered modal with a backdrop. Embedded mode also disables the
   * focus trap and the trigger-focus restoration so it co-exists
   * cleanly with the rest of the page. In embedded mode, `open` and
   * `onClose` default to the surrounding CliContext so the rail can
   * mount the bar with no props.
   */
  embedded?: boolean;
}

/**
 * Task #626 — decide whether the auto-nav toast may offer a "Go back"
 * action that restores `prev` (the route the user was on before the
 * assistant moved them).
 *
 * It is unsafe when the assistant navigated the user UP to a parent/list
 * surface: that is exactly the pattern `resolveNavPath` uses after a
 * delete (it sends deletes to the parent precisely because the entity's
 * own detail page is gone). In that case `prev` is the just-deleted
 * detail page and restoring it would 404 — so we suppress the return
 * action and leave the user on the safe page the assistant chose. All
 * other navigations (creates, edits, sideways jumps) leave `prev` valid,
 * so "Go back" is offered.
 */
export function isSafeAutoNavReturn(prev: string, dest: string): boolean {
  const prevPath = prev.split(/[?#]/)[0];
  const destPath = dest.split(/[?#]/)[0];
  if (!prevPath || !destPath) return false;
  // Same page — nothing to return to.
  if (prevPath === destPath) return false;
  // Root is an ancestor of everything; never treat a jump to "/" as a
  // delete-style "moved up" navigation.
  if (destPath === "/") return true;
  const destPrefix = destPath.endsWith("/") ? destPath : destPath + "/";
  // `prev` is a strict descendant of the destination → the assistant
  // moved the user up to a parent/list (delete pattern). Restoring the
  // child risks a 404.
  if (prevPath.startsWith(destPrefix)) return false;
  return true;
}

/**
 * Task #626 — a guaranteed-valid fallback for the auto-nav "Go back"
 * action. Collapses any route to its top-level listing surface (e.g.
 * `/accounts/123/contacts/9` → `/accounts`), which is always a real,
 * non-detail page. Used at click time when the captured `prev` is no
 * longer safe to restore, so the user never lands on a 404.
 */
export function autoNavReturnFallback(prev: string): string {
  const prevPath = prev.split(/[?#]/)[0] ?? "";
  const seg = prevPath.split("/").filter(Boolean)[0];
  return seg ? `/${seg}` : "/";
}

export function CommandBar(props: CommandBarProps) {
  const { triggerRef, embedded = false } = props;
  const _cliCtxForProps = React.useContext(CliContext);
  const open = props.open ?? (embedded ? _cliCtxForProps.open : false);
  // Task #501 — `onClose` is referenced as an effect dep below; stabilize
  // its identity so the focus-management effect doesn't re-fire (and
  // re-call setSavedPrompts) on every render, which would loop.
  const propsOnClose = props.onClose;
  const ctxSetOpen = _cliCtxForProps.setOpen;
  const onClose = React.useCallback(() => {
    if (propsOnClose) propsOnClose();
    else ctxSetOpen(false);
  }, [propsOnClose, ctxSetOpen]);
  const [location, setLocation] = useLocation();
  const [locale, setLocale] = React.useState<CliLocale>(() => {
    if (typeof window === "undefined") return "en";
    return (window.localStorage.getItem("atelier-cli-locale") as CliLocale) ?? "en";
  });
  const dir = locale === "ar" ? "rtl" : "ltr";

  // Task #498 — auto-navigation preference. Defaults to enabled; when
  // the user opts out from Settings, the chat keeps its result card on
  // screen but does not change the underlying route.
  const [autoNavEnabled] = useAutoNavEnabled();
  const localeRef = React.useRef(locale);
  React.useEffect(() => {
    localeRef.current = locale;
  }, [locale]);
  // Title hint for the toast — derived from the active turn so the
  // toast can read "Jumped to <opportunity name>" instead of just the
  // raw path. Refs are read lazily inside handleCliNavigate so the
  // callback identity stays stable across renders.
  const navLabelRef = React.useRef<string | null>(null);

  // Task #495 — let the chat agent auto-navigate to the relevant
  // screen when it proposes or commits a write. CommandBar is
  // mounted in the Shell above the route Switch, so navigation
  // does not unmount the chat panel and the active stream stays
  // alive across page changes.
  //
  // Task #498 — also surface a non-blocking toast with a "Stay here"
  // affordance that restores the previous route, and respect the
  // user's auto-nav preference.
  const handleCliNavigate = React.useCallback(
    (path: string) => {
      if (typeof path !== "string" || !path.startsWith("/")) return;
      if (!autoNavEnabled) return;
      const prev =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search + window.location.hash
          : null;
      // No-op if we're already on the destination — avoids a redundant
      // history entry and a confusing "Stay here" that goes nowhere.
      if (prev && prev === path) return;
      setLocation(path);
      const lc = localeRef.current;
      const label = (navLabelRef.current ?? path).slice(0, 80);
      // Task #626 — only offer "Go back" when restoring `prev` is safe.
      // When the assistant moved the user UP to a parent/list (the
      // pattern the server uses after a delete, since the entity's own
      // detail page is gone), restoring `prev` would land on a 404, so
      // we suppress the return action and only let the user stay.
      const canReturn = !!prev && isSafeAutoNavReturn(prev, path);
      const btnBase =
        "inline-flex h-8 shrink-0 items-center justify-center rounded px-3 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gold";
      try {
        showToast({
          // Solid, fully-opaque surface so the underlying chat input
          // never bleeds through (works in both light and dark themes).
          className: "border-border bg-bg-elevate text-text shadow-lg",
          title: sFmt("autoNavToastTitle", lc, { label }),
          description: s("autoNavToastDescription", lc),
          action: (
            <div className="flex shrink-0 flex-col gap-2">
              {canReturn ? (
                <ToastAction
                  altText={s("autoNavGoBack", lc)}
                  onClick={() => {
                    // Re-validate at click time: the user may have moved
                    // on since the toast appeared, or the entity at `prev`
                    // may now be gone. If returning is no longer safe,
                    // fall back to a guaranteed-valid listing page so the
                    // return action can never 404.
                    const here =
                      typeof window !== "undefined"
                        ? window.location.pathname +
                          window.location.search +
                          window.location.hash
                        : null;
                    const target =
                      here && !isSafeAutoNavReturn(prev!, here)
                        ? autoNavReturnFallback(prev!)
                        : prev!;
                    setLocation(target);
                  }}
                  data-testid="cli-autonav-go-back"
                  className={`${btnBase} border border-border bg-bg-elevate-2 text-text hover:bg-bg-deep`}
                >
                  {s("autoNavGoBack", lc)}
                </ToastAction>
              ) : null}
              <ToastAction
                altText={s("autoNavStayHere", lc)}
                data-testid="cli-autonav-stay-here"
                className={`${btnBase} bg-gold text-bg-deep hover:bg-gold-soft`}
              >
                {s("autoNavStayHere", lc)}
              </ToastAction>
            </div>
          ),
        });
      } catch {
        /* swallow — UI feedback must never break the stream */
      }
    },
    [setLocation, autoNavEnabled],
  );
  const cli = useCli({ locale, onNavigate: handleCliNavigate });
  // Keep the toast label ref in sync with the active turn so the
  // user sees a meaningful "Jumped to <X>" instead of a path.
  React.useEffect(() => {
    const c = cli.current;
    navLabelRef.current =
      c?.result?.title ??
      c?.pending?.summary ??
      (c?.prompt ? c.prompt.slice(0, 60) : null);
  }, [cli.current]);
  const pageCtx = React.useMemo(() => derivePageContext(location), [location]);
  const cliCtx = React.useContext(CliContext);
  // Register the bar's turn-injector with the context so deep-link
  // pages and the right-rail can land directly on a historical turn.
  React.useEffect(() => {
    cliCtx.registerInjectTurn(cli.injectHistoricalTurn);
    return () => cliCtx.registerInjectTurn(() => {});
  }, [cliCtx, cli.injectHistoricalTurn]);
  // Drain any pending hydration request whenever the bar opens.
  React.useEffect(() => {
    if (!open) return;
    const req = cliCtx.consumeHydration();
    if (!req) return;
    if (req.prompt) {
      setInput(req.prompt);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
    if (req.sessionId) {
      void fetch(`/api/atelier/cli/sessions/${encodeURIComponent(req.sessionId)}`, {
        credentials: "include",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { turns?: Array<Record<string, unknown>> } | null) => {
          if (!j?.turns) return;
          const targets = req.turnId
            ? j.turns.filter((t) => t.id === req.turnId)
            : j.turns.slice(0, 5);
          for (const row of targets.reverse()) {
            cli.injectHistoricalTurn(rowToHistoricalTurn(row));
          }
        })
        .catch(() => {
          /* silent */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [input, setInput] = React.useState("");
  const [attachments, setAttachments] = React.useState<
    Array<{ id: string; name: string; size: number; mime: string; error?: string }>
  >([]);
  const [slashOpen, setSlashOpen] = React.useState(false);
  const [slashIndex, setSlashIndex] = React.useState(0);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [savedOpen, setSavedOpen] = React.useState(false);
  const [savedPrompts, setSavedPrompts] = React.useState<SavedPrompt[]>([]);
  const [typedName, setTypedName] = React.useState("");
  const [showAllSteps, setShowAllSteps] = React.useState(false);
  const [editingPlanRow, setEditingPlanRow] = React.useState<number | null>(null);

  const composerRef = React.useRef<HTMLTextAreaElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const transcriptRef = React.useRef<HTMLDivElement>(null);
  const lastPromptRef = React.useRef<string>("");

  const reduced = useReducedMotion();

  // Persist locale across opens.
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("atelier-cli-locale", locale);
    }
  }, [locale]);

  // Focus management: open → focus composer; Esc → close + restore;
  // Tab/Shift+Tab → wrap inside the dialog so focus can never escape
  // to the page underneath while the modal is open. We re-query the
  // tabbable set on each Tab keypress so dynamically-rendered chrome
  // (slash menu, drawer panels, plan rows) is included automatically.
  React.useEffect(() => {
    if (!open) return;
    setSavedPrompts(listSavedPrompts());
    const t = setTimeout(() => composerRef.current?.focus(), 30);

    const TABBABLE =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Task #501 — embedded mode (rail) skips the focus trap so the
      // user can Tab between the agent panel and the rest of the page.
      if (embedded) return;
      if (e.key === "Tab" && panelRef.current) {
        const nodes = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(TABBABLE),
        ).filter((el) => !el.hasAttribute("aria-hidden") && el.offsetParent !== null);
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement as HTMLElement | null;
        // Wrap focus at both ends. Tab on last → first; Shift+Tab on
        // first (or anywhere outside the panel) → last.
        if (e.shiftKey) {
          if (active === first || !panelRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !panelRef.current.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);

    // Defensive: if focus somehow lands outside (e.g., a 3rd-party
    // tooltip portal), pull it back to the composer. Skipped in
    // embedded mode (rail) so the user can click around the page
    // without focus snapping back to the agent composer.
    const onFocusIn = (e: FocusEvent) => {
      if (embedded) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        composerRef.current?.focus();
      }
    };
    if (!embedded) document.addEventListener("focusin", onFocusIn);

    return () => {
      window.removeEventListener("keydown", onKey);
      if (!embedded) document.removeEventListener("focusin", onFocusIn);
      clearTimeout(t);
      // Focus restoration: defer one frame so any close animation
      // doesn't fight us for the active element. Embedded mode (rail)
      // doesn't restore focus — the rail has no single trigger button
      // to return to.
      if (!embedded) {
        requestAnimationFrame(() => {
          triggerRef?.current?.focus();
        });
      }
    };
  }, [open, onClose, triggerRef, embedded]);

  // Auto-scroll transcript on new content.
  React.useEffect(() => {
    if (!open) return;
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, cli.turns, cli.current]);

  // ⌘↩ / Ctrl+↩ confirms a pending plan.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (cli.current?.status === "needs_confirmation") {
          e.preventDefault();
          handleConfirm();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Filtered slash candidates: filter the catalog by the token after `/`.
  const slashToken = input.startsWith("/") ? input.slice(1).split(/\s/)[0].toLowerCase() : "";
  const slashCandidates = React.useMemo<CliCapability[]>(() => {
    if (!input.startsWith("/")) return [];
    const tok = slashToken;
    return cli.capabilities
      .filter((c) => {
        if (!tok) return true;
        const aliases = [
          ...(c.slashAliases.en ?? []),
          ...(c.slashAliases.ar ?? []),
          ...(c.slashAliases.fr ?? []),
          c.toolName,
          c.id,
        ];
        return aliases.some((a) => a.toLowerCase().includes(tok));
      })
      .slice(0, 8);
  }, [input, slashToken, cli.capabilities]);

  React.useEffect(() => {
    const willOpen = input.startsWith("/") && slashCandidates.length > 0;
    setSlashOpen((wasOpen) => {
      // Task #342 — record cli.opened with source=slash_command the
      // first time the slash menu opens after being closed. Treats
      // each open transition as a discrete entry-point event so we
      // can attribute opens via the slash command syntax.
      if (willOpen && !wasOpen) {
        try {
          const surface = derivePageContext(window.location.pathname).surface;
          emitCliOpened("slash_command", { surface });
        } catch {
          /* ignore telemetry errors */
        }
      }
      return willOpen;
    });
    setSlashIndex(0);
  }, [input, slashCandidates.length]);

  function pickSlash(c: CliCapability) {
    const alias = c.slashAliases[locale]?.[0] ?? c.slashAliases.en?.[0] ?? c.toolName;
    setInput(`/${alias} `);
    setSlashOpen(false);
    composerRef.current?.focus();
  }

  function handleSubmit(intent: "read" | "write" | null = null, dryRun = false) {
    const text = input.trim();
    if (!text || cli.status === "streaming") return;
    if (text.length > MAX_INPUT_CHARS) return;
    // /help is a pure client-side concern: it opens the catalog drawer
    // instead of round-tripping to the orchestrator. Match the locale's
    // alias plus the bare /help and /? canonical forms so a user typing
    // any of them gets the drawer.
    const head = text.split(/\s/)[0].toLowerCase();
    if (head === "/help" || head === "/?" || head === "/aide" || head === "/مساعدة") {
      setHelpOpen(true);
      setSavedOpen(false);
      setInput("");
      setSlashOpen(false);
      return;
    }
    lastPromptRef.current = text;
    setInput("");
    setSlashOpen(false);
    setShowAllSteps(false);
    setTypedName("");
    setEditingPlanRow(null);
    void cli.submit({
      prompt: text,
      // Attachments are UI-only in this task — Task #334 ships the
      // real upload pipeline. Sending the synthetic client-side IDs
      // would generate dangling refs server-side, so we forward an
      // empty list. Chips remain visible so the user sees what they
      // attached; the file payload reaches the orchestrator only after
      // #334 lands.
      attachmentIds: [] as string[],
      pageContext: pageCtx,
      dryRun,
      intent,
    });
  }

  function handleConfirm() {
    // Task #24 — duplicate click while a confirm is streaming: no-op.
    if (cli.confirming) return;
    const required = cli.current?.pending?.typedNameRequired;
    if (required && typedName.trim() !== required.trim()) {
      // Server will also reject; we surface the local check immediately
      // so the user doesn't pay the round-trip.
      return;
    }
    // Forward the *user-entered* typed name (not the prompt name) so
    // the server-side audit log records what the human actually typed.
    // Plan-row exclusions are forwarded for #334/#335 enforcement; the
    // current server confirm path ignores unknown body fields.
    void cli.confirm(
      required ? typedName.trim() : undefined,
      cli.current?.excludedStepIndexes ?? [],
      cli.current?.planEdits ?? {},
    );
    setTypedName("");
    setEditingPlanRow(null);
  }

  function handleAttach(files: FileList | null) {
    if (!files) return;
    const next = [...attachments];
    for (const f of Array.from(files)) {
      const id = `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      let error: string | undefined;
      if (f.size > MAX_FILE_BYTES) error = s("fileTooLarge", locale);
      else if (f.type && !ALLOWED_MIME.has(f.type)) error = s("fileTypeRejected", locale);
      next.push({ id, name: f.name, size: f.size, mime: f.type, error });
    }
    setAttachments(next);
  }

  function removeAttachment(id: string) {
    setAttachments(attachments.filter((a) => a.id !== id));
  }

  function recallLast() {
    if (lastPromptRef.current) {
      setInput(lastPromptRef.current);
      requestAnimationFrame(() => {
        composerRef.current?.focus();
        composerRef.current?.setSelectionRange(
          lastPromptRef.current.length,
          lastPromptRef.current.length,
        );
      });
    }
  }

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(slashCandidates.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && slashCandidates[slashIndex]) {
        e.preventDefault();
        pickSlash(slashCandidates[slashIndex]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    if (e.key === "ArrowUp" && input === "" && lastPromptRef.current) {
      e.preventDefault();
      recallLast();
    }
  }

  function copyText(t: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(t);
    }
  }

  function exportTranscriptMarkdown() {
    const lines: string[] = [`# Atelier CLI transcript — ${new Date().toISOString()}`, ""];
    for (const t of [...cli.turns].reverse()) {
      lines.push(`## ${t.prompt}`);
      lines.push(`_status: ${t.status}_`);
      if (t.result) {
        lines.push(`**${t.result.title}** — ${t.result.summary ?? ""}`);
        for (const e of t.result.entities ?? []) lines.push(`- ${e.kind}: ${e.label}`);
      }
      if (t.error) lines.push(`> ERROR ${t.error.code}: ${t.error.message}`);
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atelier-cli-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function saveCurrentAsShortcut() {
    const c = cli.current;
    if (!c) return;
    const label = c.prompt.slice(0, 60);
    const sp = addSavedPrompt({
      label,
      prompt: c.prompt,
      locale,
      // Stamp the prompt with the catalog version active at save time;
      // a later catalog roll surfaces the stale-warning chip in the
      // saved drawer (SavedPanel below).
      schemaVersionAtSave: cli.catalogSchemaVersion ?? 1,
    });
    setSavedPrompts((rows) => [sp, ...rows]);
  }

  // Task #342 — when the user opened the assistant from Home, lead the
  // empty state with the same role-aware Home chips so the bar feels
  // like a continuation of the Home prompt, not a separate menu.
  // NOTE: this hook MUST be declared before the `open` early-return so
  // hook order stays stable across the closed→open transition.
  const { data: me } = useAtelierGetMe();
  const suggestions = React.useMemo(() => {
    if (pageCtx.surface === "home") {
      return homeSuggestionsFor(me?.role, locale, cli.capabilities);
    }
    // Task #341 — pass the visible read capabilities so per-page chips
    // can be enriched from catalog `surfaceOn` declarations. Filter to
    // reads (isWrite=false) so the empty state surfaces "show me…"
    // questions, not destructive verbs.
    const readsOnly = (cli.capabilities ?? []).filter((c) => c.isWrite === false);
    return suggestionsFor(pageCtx, locale, readsOnly);
  }, [pageCtx, locale, me?.role, cli.capabilities]);

  if (!open) return null;

  const status = cli.status;
  const current = cli.current;

  // Task #501 — embedded mode (right-rail Agent tab) renders the panel
  // body inline inside its parent (no fixed/backdrop wrapper, no fixed
  // sizing, no ContextPanel — the rail is too narrow to host it).
  const panel = (
    <div
      ref={panelRef}
      dir={dir}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-label="Atelier command bar"
      className={cn(
        embedded
          ? "relative w-full h-full bg-bg-deep flex flex-col overflow-hidden text-text"
          : cn(
              "relative w-full sm:w-[760px] sm:max-w-[calc(100vw-2rem)]",
              "h-[88vh] sm:h-[640px] sm:max-h-[calc(100vh-3rem)]",
              "bg-bg-deep border border-border sm:rounded-xl shadow-2xl",
              "flex flex-col overflow-hidden text-text",
            ),
      )}
      data-testid="cli-panel"
      data-status={status}
      data-locale={locale}
      data-embedded={embedded ? "1" : "0"}
    >
      <Header
        locale={locale}
        onLocaleChange={setLocale}
        onClose={onClose}
        onHelp={() => {
          setHelpOpen((v) => !v);
          setSavedOpen(false);
        }}
        onSaved={() => {
          setSavedOpen((v) => !v);
          setHelpOpen(false);
        }}
        surface={pageCtx.surface}
        status={status}
        hideClose={embedded}
      />

      <div className="flex-1 flex min-h-0">
        <div ref={transcriptRef} className="flex-1 overflow-y-auto scrollbar-thin min-w-0">
          {helpOpen ? (
            <HelpPanel
              capabilities={cli.capabilities}
              error={cli.capabilitiesError}
              locale={locale}
            />
          ) : savedOpen ? (
            <SavedPanel
              prompts={savedPrompts}
              currentSchemaVersion={cli.catalogSchemaVersion ?? 1}
              locale={locale}
              onRun={(p) => {
                setSavedOpen(false);
                setLocale(p.locale);
                lastPromptRef.current = p.prompt;
                void cli.submit({ prompt: p.prompt, pageContext: pageCtx });
              }}
              onDelete={(id) => {
                deleteSavedPrompt(id);
                setSavedPrompts(listSavedPrompts());
              }}
            />
          ) : (
            <Transcript
              turns={cli.turns}
              current={current}
              suggestions={suggestions}
              capabilities={cli.capabilities}
              locale={locale}
              dir={dir}
              reduced={reduced}
              showAllSteps={showAllSteps}
              setShowAllSteps={setShowAllSteps}
              editingPlanRow={editingPlanRow}
              setEditingPlanRow={setEditingPlanRow}
              typedName={typedName}
              setTypedName={setTypedName}
              confirming={cli.confirming}
              onConfirm={handleConfirm}
              onCancelTurn={() => void cli.cancel()}
              onPickDisambig={(id, label) => void cli.pickDisambig(id, label)}
              onToggleStep={cli.toggleStepExclusion}
              onSetRowEdit={cli.setPlanRowEdit}
              onPickSuggestion={(text) => {
                // Task #342 — clicking an empty-state chip is a real
                // discoverability entry-point: the user picked a
                // canned prompt instead of typing their own. Emit
                // cli.opened with source=empty_state_chip so we can
                // attribute these picks separately from header /
                // shortcut opens.
                try {
                  emitCliOpened("empty_state_chip", {
                    surface: pageCtx.surface,
                    prompt: text,
                  });
                } catch {
                  /* ignore telemetry errors */
                }
                setInput(text);
                requestAnimationFrame(() => composerRef.current?.focus());
              }}
              onRequestCapability={(prompt) =>
                void cli.submit({
                  prompt: `/request ${prompt}`,
                  pageContext: pageCtx,
                })
              }
              onSubmitClarification={(answer) =>
                void cli.submit({ prompt: answer, pageContext: pageCtx })
              }
              onCopyJson={(t) => copyText(JSON.stringify(t.proposedPlan ?? t.pending ?? {}, null, 2))}
              onCopyMarkdown={(t) =>
                copyText(`# ${t.prompt}\n\n${t.result?.summary ?? ""}`)
              }
              onExport={exportTranscriptMarkdown}
              onSaveShortcut={saveCurrentAsShortcut}
            />
          )}
        </div>
        {!embedded && <ContextPanel pageCtx={pageCtx} locale={locale} />}
      </div>

      <Composer
        input={input}
        onInput={setInput}
        onKeyDown={onComposerKey}
        onSubmit={() => handleSubmit()}
        onAttach={() => fileInputRef.current?.click()}
        onDropFiles={(fl) => handleAttach(fl)}
        attachments={attachments}
        onRemoveAttachment={removeAttachment}
        locale={locale}
        status={status}
        slashOpen={slashOpen}
        slashCandidates={slashCandidates}
        slashIndex={slashIndex}
        onPickSlash={pickSlash}
        composerRef={composerRef}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleAttach(e.target.files)}
        data-testid="cli-file-input"
      />
    </div>
  );

  // Task #501 — the centered modal has been removed. The bar is now
  // exclusively rendered embedded inside the right-rail Agent tab, so
  // there is no fixed-position / backdrop wrapper.
  return panel;
}

/* ───────────────────────────── Header ───────────────────────────── */

function Header({
  locale,
  onLocaleChange,
  onClose,
  onHelp,
  onSaved,
  surface,
  status,
  hideClose = false,
}: {
  locale: CliLocale;
  onLocaleChange: (l: CliLocale) => void;
  onClose: () => void;
  onHelp: () => void;
  onSaved: () => void;
  surface: string;
  status: string;
  /** Task #501 — hide the X close button when the bar is embedded in
   * the right rail (the rail's collapse chevron handles dismissal). */
  hideClose?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-bg-elevate">
      <Sparkles className="w-4 h-4 text-gold shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold leading-tight">The Atelier</div>
        <div className="text-[11px] font-mono text-text-faint uppercase tracking-wider truncate">
          {surface.replaceAll("_", " ")} · {status}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onLocaleChange(locale === "en" ? "ar" : "en")}
        className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-text-mute hover:text-gold transition-colors px-2 py-1 rounded hover:bg-bg-elevate-2"
        title={s("localeLabel", locale)}
        data-testid="cli-locale-toggle"
      >
        <Languages className="w-3.5 h-3.5" />
        {locale.toUpperCase()}
      </button>
      <button
        type="button"
        onClick={onSaved}
        className="text-text-mute hover:text-gold p-1.5 rounded hover:bg-bg-elevate-2 transition-colors"
        title={s("savedDrawerTitle", locale)}
        data-testid="cli-saved-toggle"
      >
        <Bookmark className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onHelp}
        className="text-text-mute hover:text-gold p-1.5 rounded hover:bg-bg-elevate-2 transition-colors"
        title={s("helpTitle", locale)}
        data-testid="cli-help-toggle"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {!hideClose && (
        <button
          type="button"
          onClick={onClose}
          className="text-text-mute hover:text-text p-1.5 rounded hover:bg-bg-elevate-2 transition-colors"
          title={s("close", locale)}
          data-testid="cli-close"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────── Composer ─────────────────────────── */

function Composer({
  input,
  onInput,
  onKeyDown,
  onSubmit,
  onAttach,
  onDropFiles,
  attachments,
  onRemoveAttachment,
  locale,
  status,
  slashOpen,
  slashCandidates,
  slashIndex,
  onPickSlash,
  composerRef,
}: {
  input: string;
  onInput: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  onAttach: () => void;
  onDropFiles: (fl: FileList) => void;
  attachments: Array<{ id: string; name: string; size: number; mime: string; error?: string }>;
  onRemoveAttachment: (id: string) => void;
  locale: CliLocale;
  status: string;
  slashOpen: boolean;
  slashCandidates: CliCapability[];
  slashIndex: number;
  onPickSlash: (c: CliCapability) => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [dragOver, setDragOver] = React.useState(false);
  const overLimit = input.length > MAX_INPUT_CHARS;
  return (
    <div
      className={cn(
        "border-t border-border bg-bg-elevate p-3 shrink-0 relative",
        dragOver && "ring-2 ring-gold ring-inset",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files) onDropFiles(e.dataTransfer.files);
      }}
      data-testid="cli-composer"
    >
      {slashOpen && (
        <div
          className="absolute bottom-full left-3 right-3 mb-1 bg-bg-deep border border-border rounded-md shadow-2xl overflow-hidden"
          role="listbox"
          aria-label="Slash commands"
          data-testid="cli-slash-menu"
        >
          {slashCandidates.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={i === slashIndex}
              onClick={() => onPickSlash(c)}
              className={cn(
                "w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-3 transition-colors",
                i === slashIndex ? "bg-bg-elevate-2 text-gold" : "hover:bg-bg-elevate text-text",
              )}
              data-testid="cli-slash-item"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs text-gold shrink-0">
                  /{c.slashAliases[locale]?.[0] ?? c.slashAliases.en?.[0] ?? c.toolName}
                </span>
                <span className="text-text-mute text-xs truncate">{c.description}</span>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-text-faint shrink-0">
                {c.module}
                {c.irreversible ? " · ⚠" : c.isWrite ? " · ✎" : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2" data-testid="cli-attachments">
          {attachments.map((a) => (
            <span
              key={a.id}
              className={cn(
                "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono border",
                a.error
                  ? "bg-danger/10 border-danger/40 text-danger"
                  : "bg-bg-elevate-2 border-border text-text-mute",
              )}
              title={a.error ?? `${(a.size / 1024).toFixed(1)} KB · ${a.mime || "?"}`}
              data-testid="cli-attachment-chip"
            >
              <Paperclip className="w-3 h-3" />
              <span className="max-w-[160px] truncate">{a.name}</span>
              <button
                type="button"
                onClick={() => onRemoveAttachment(a.id)}
                aria-label="remove"
                className="hover:text-text"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={onAttach}
          className="text-text-mute hover:text-gold p-2 rounded hover:bg-bg-elevate-2 transition-colors shrink-0"
          title={s("attach", locale)}
          data-testid="cli-attach-button"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <textarea
          ref={composerRef}
          value={input}
          onChange={(e) => onInput(e.target.value.slice(0, MAX_INPUT_CHARS + 200))}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={s("placeholder", locale)}
          aria-invalid={overLimit || undefined}
          aria-label={s("placeholder", locale)}
          disabled={status === "streaming"}
          className={cn(
            "flex-1 resize-none text-xs leading-relaxed bg-bg-deep border rounded-md px-2.5 py-1.5",
            "focus:outline-none focus:ring-1 max-h-40 placeholder:text-text-faint",
            "disabled:opacity-60",
            overLimit
              ? "border-danger focus:ring-danger"
              : "border-border focus:ring-gold focus:border-gold",
          )}
          data-testid="cli-input"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={!input.trim() || status === "streaming" || overLimit}
          className={cn(
            "shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-md transition-colors",
            "bg-gold text-bg-deep hover:bg-gold/90 disabled:bg-bg-elevate-2 disabled:text-text-faint",
          )}
          aria-label={s("send", locale)}
          title={s("send", locale)}
          data-testid="cli-send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-text-faint">
        <span>
          {s("newline", locale)} · {s("recallHint", locale)}
        </span>
        <span data-testid="cli-char-count">
          {input.length}/{MAX_INPUT_CHARS}
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────── Transcript ─────────────────────────── */

function Transcript({
  turns,
  current,
  suggestions,
  capabilities,
  locale,
  dir,
  reduced,
  showAllSteps,
  setShowAllSteps,
  editingPlanRow,
  setEditingPlanRow,
  typedName,
  setTypedName,
  confirming,
  onConfirm,
  onCancelTurn,
  onPickDisambig,
  onToggleStep,
  onSetRowEdit,
  onPickSuggestion,
  onRequestCapability,
  onSubmitClarification,
  onCopyJson,
  onCopyMarkdown,
  onExport,
  onSaveShortcut,
}: {
  turns: CliTurn[];
  current: CliTurn | null;
  suggestions: Array<{ text: string }>;
  capabilities: CliCapability[];
  locale: CliLocale;
  dir: "ltr" | "rtl";
  reduced: boolean;
  showAllSteps: boolean;
  setShowAllSteps: (v: boolean) => void;
  editingPlanRow: number | null;
  setEditingPlanRow: (n: number | null) => void;
  typedName: string;
  setTypedName: (v: string) => void;
  confirming: boolean;
  onConfirm: () => void;
  onCancelTurn: () => void;
  onPickDisambig: (id: string, label: string) => void;
  onToggleStep: (i: number) => void;
  onSetRowEdit: (i: number, label: string) => void;
  onPickSuggestion: (t: string) => void;
  onRequestCapability: (prompt: string) => void;
  onSubmitClarification: (answer: string) => void;
  onCopyJson: (t: CliTurn) => void;
  onCopyMarkdown: (t: CliTurn) => void;
  onExport: () => void;
  onSaveShortcut: () => void;
}) {
  if (turns.length === 0) {
    // Task #342 — friendlier conversational invitation. Slash-command
    // hint demoted to a small helper line so the bar reads as a chat,
    // not a CLI. Slash commands remain available via `/`.
    return (
      <div className="p-4 space-y-4" data-testid="cli-empty">
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-text leading-snug">
            {s("emptyConversational", locale)}
          </h3>
          <p className="text-xs text-text-faint leading-relaxed">
            {s("emptyHint", locale)}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {suggestions.map((sug) => (
            <button
              key={sug.text}
              type="button"
              onClick={() => onPickSuggestion(sug.text)}
              className="text-start text-xs bg-bg-elevate hover:bg-bg-elevate-2 border border-border hover:border-gold/50 rounded-md px-2.5 py-1.5 transition-colors"
              data-testid="cli-suggestion"
            >
              {sug.text}
            </button>
          ))}
        </div>
        <p className="text-[11px] font-mono text-text-faint pt-2 border-t border-border-soft">
          {s("emptySlashHint", locale)}
        </p>
      </div>
    );
  }

  return (
    <div
      className="p-4 space-y-5"
      role="log"
      aria-live="polite"
      aria-busy={current?.status === "streaming"}
      data-testid="cli-transcript"
    >
      {[...turns].reverse().map((t) => {
        const isCurrent = t.clientTurnKey === current?.clientTurnKey;
        return (
          <div key={t.clientTurnKey} data-testid="cli-turn" data-status={t.status}>
            <div
              className={cn("flex mb-2", dir === "rtl" ? "justify-start" : "justify-end")}
              data-testid="cli-user-bubble"
            >
              <div className="max-w-[85%] bg-gold/10 border border-gold/30 text-text rounded-2xl px-3 py-1.5 text-xs leading-relaxed">
                {t.prompt}
              </div>
            </div>
            <div className={cn("flex", dir === "rtl" ? "justify-end" : "justify-start")}>
              <div className="max-w-[92%] w-full">
                <TurnBody
                  turn={t}
                  isCurrent={isCurrent}
                  capabilities={capabilities}
                  locale={locale}
                  reduced={reduced}
                  showAllSteps={showAllSteps}
                  setShowAllSteps={setShowAllSteps}
                  editingPlanRow={editingPlanRow}
                  setEditingPlanRow={setEditingPlanRow}
                  typedName={typedName}
                  setTypedName={setTypedName}
                  confirming={confirming}
                  onConfirm={onConfirm}
                  onCancelTurn={onCancelTurn}
                  onPickDisambig={onPickDisambig}
                  onToggleStep={onToggleStep}
                  onSetRowEdit={onSetRowEdit}
                  onPickSuggestion={onPickSuggestion}
                  onRequestCapability={onRequestCapability}
                  onSubmitClarification={onSubmitClarification}
                  onCopyJson={() => onCopyJson(t)}
                  onCopyMarkdown={() => onCopyMarkdown(t)}
                  onExport={onExport}
                  onSaveShortcut={onSaveShortcut}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Short, human-friendly host label for a source link fallback. */
function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 24);
  }
}

/**
 * A single trace breadcrumb. When the step carries `sources` (e.g. a
 * web-search agent's "Read N sources" step), it renders as a toggle that
 * expands to reveal the source titles, each linking out to the page.
 */
function BreadcrumbRow({
  line,
}: {
  line: { text: string; sources?: Array<{ url: string; title?: string }> };
}) {
  const [open, setOpen] = React.useState(false);
  // Defense in depth: only ever render http(s) sources as clickable links,
  // even though useCli already filters at ingest.
  const sources = (line.sources ?? []).filter((src) => isSafeHttpUrl(src.url));
  if (sources.length === 0) {
    return <div className="leading-snug">{line.text}</div>;
  }
  return (
    <div className="leading-snug">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-left hover:text-text"
        aria-expanded={open}
        data-testid="cli-sources-toggle"
      >
        {open ? (
          <ChevronUp className="w-3 h-3 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="w-3 h-3 shrink-0" aria-hidden />
        )}
        <span>{line.text}</span>
      </button>
      {open && (
        <ul className="mt-1 ms-4 space-y-0.5 border-s border-border ps-2" data-testid="cli-sources-list">
          {sources.map((src, j) => (
            <li key={j} className="truncate">
              <a
                href={src.url}
                target="_blank"
                rel="noreferrer"
                title={src.title || src.url}
                className="inline-flex items-center gap-1 text-gold/80 hover:text-gold"
              >
                <ExternalLink className="w-2.5 h-2.5 shrink-0" aria-hidden />
                <span className="truncate">{src.title || sourceHost(src.url)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TurnBody({
  turn,
  isCurrent,
  capabilities,
  locale,
  reduced,
  showAllSteps,
  setShowAllSteps,
  editingPlanRow,
  setEditingPlanRow,
  typedName,
  setTypedName,
  confirming,
  onConfirm,
  onCancelTurn,
  onPickDisambig,
  onToggleStep,
  onSetRowEdit,
  onPickSuggestion,
  onRequestCapability,
  onSubmitClarification,
  onCopyJson,
  onCopyMarkdown,
  onExport,
  onSaveShortcut,
}: {
  turn: CliTurn;
  isCurrent: boolean;
  capabilities: CliCapability[];
  locale: CliLocale;
  reduced: boolean;
  showAllSteps: boolean;
  setShowAllSteps: (v: boolean) => void;
  editingPlanRow: number | null;
  setEditingPlanRow: (n: number | null) => void;
  typedName: string;
  setTypedName: (v: string) => void;
  confirming: boolean;
  onConfirm: () => void;
  onCancelTurn: () => void;
  onPickDisambig: (id: string, label: string) => void;
  onToggleStep: (i: number) => void;
  onSetRowEdit: (i: number, label: string) => void;
  onPickSuggestion: (t: string) => void;
  onRequestCapability: (prompt: string) => void;
  onSubmitClarification: (answer: string) => void;
  onCopyJson: () => void;
  onCopyMarkdown: () => void;
  onExport: () => void;
  onSaveShortcut: () => void;
}) {
  // Task #573 — an "action turn" is any write flow (delete/update/create):
  // it is awaiting confirmation, has a pending confirm box, or has already
  // committed a propose_write. These turns are anchored by the single
  // Confirm/Edit/Cancel box (and its success card), so the planning
  // breadcrumb/narration trace and single-step plan are pure noise here.
  const isActionTurn =
    turn.status === "needs_confirmation" ||
    !!turn.pending ||
    (turn.toolResults?.some((t) => t.tool === "propose_write") ?? false);

  // Live mm:ss elapsed timer while the turn streams, so a multi-minute
  // agent run never looks frozen. Re-ticks once a second; stops as soon as
  // the turn leaves the streaming state.
  const isStreaming = turn.status === "streaming";
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isStreaming]);
  const elapsedSec = turn.startedAt
    ? Math.max(0, Math.floor((nowMs - turn.startedAt) / 1000))
    : 0;
  const elapsedLabel = `${String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:${String(
    elapsedSec % 60,
  ).padStart(2, "0")}`;
  // Latest live step (progress / plan / tool breadcrumb) becomes the
  // streaming caption instead of a static "Thinking…".
  const latestStep = [...turn.trace].reverse().find((l) => l.kind === "step");
  const streamingCaption = latestStep?.text?.trim() || s("thinking", locale);
  return (
    <div className="space-y-2.5">
      {!isActionTurn && turn.trace.length > 0 && (() => {
        const recent = turn.trace.slice(-12);
        const breadcrumbs = recent.filter((l) => l.kind !== "narration");
        const narrations = recent.filter((l) => l.kind === "narration");
        return (
          <div
            className="bg-bg-elevate border border-border rounded-md px-3 py-2 space-y-2"
            data-testid="cli-trace"
          >
            {breadcrumbs.length > 0 && (
              <div className="text-[11px] font-mono text-text-mute space-y-0.5">
                {breadcrumbs.slice(-6).map((line, i) => (
                  <BreadcrumbRow key={`b${i}`} line={line} />
                ))}
              </div>
            )}
            {narrations.length > 0 && (
              <Markdown text={narrations.map((n) => n.text).join("\n\n")} />
            )}
          </div>
        );
      })()}

      {turn.status === "streaming" && (
        <div
          className="inline-flex items-center gap-2 text-text-faint text-xs"
          data-testid="cli-streaming"
        >
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full bg-gold",
              reduced ? "" : "animate-pulse",
            )}
            aria-hidden
          />
          <span className="truncate max-w-[28ch]" data-testid="cli-streaming-caption">
            {streamingCaption}
          </span>
          <span className="font-mono tabular-nums text-text-mute" data-testid="cli-streaming-timer">
            {elapsedLabel}
          </span>
          {isCurrent && (
            <button
              type="button"
              onClick={onCancelTurn}
              className="ml-2 text-text-mute hover:text-danger underline-offset-2 hover:underline"
              data-testid="cli-streaming-cancel"
            >
              {s("cancel", locale)}
            </button>
          )}
        </div>
      )}

      {turn.proactiveRecap && (
        <div
          className="bg-bg-elevate border border-gold/30 rounded-md p-3 space-y-1.5"
          data-testid="cli-proactive-recap"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-mono uppercase tracking-wider text-gold">
              {s("recapTitle", locale)}
            </div>
            {typeof turn.proactiveRecap.dormantMs === "number" &&
              turn.proactiveRecap.dormantMs > 0 && (
                <div className="text-[10px] font-mono text-text-faint">
                  {s("recapDormantHours", locale).replace(
                    "{h}",
                    String(Math.round(turn.proactiveRecap.dormantMs / 3_600_000)),
                  )}
                </div>
              )}
          </div>
          {turn.proactiveRecap.summary && (
            <div className="text-xs text-text leading-relaxed whitespace-pre-wrap">
              {turn.proactiveRecap.summary}
            </div>
          )}
          {turn.proactiveRecap.entities && turn.proactiveRecap.entities.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {turn.proactiveRecap.entities.map((e) => (
                <span
                  key={`${e.kind}:${e.id}`}
                  className="text-[10px] font-mono bg-bg-deep border border-border rounded px-1.5 py-0.5 text-text-mute"
                >
                  {e.kind}: {e.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {turn.clarification && turn.status === "needs_clarification" && isCurrent && (
        <ClarificationCard
          clarification={turn.clarification}
          locale={locale}
          onSubmit={(answer) => onSubmitClarification(answer)}
          onCancel={onCancelTurn}
        />
      )}

      {turn.refusal && (
        <div
          className="bg-bg-elevate border border-warning/40 rounded-md p-3 space-y-2"
          data-testid="cli-refusal"
        >
          <div className="text-xs font-mono uppercase tracking-wider text-warning">
            {s("refusalTitle", locale)}
          </div>
          <div className="text-xs text-text leading-relaxed">{turn.refusal.reason}</div>
          {turn.refusal.suggestion && (
            <div className="text-xs text-text-mute leading-relaxed">
              {turn.refusal.suggestion}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {turn.refusal.pageHref && (
              <a
                href={turn.refusal.pageHref}
                className="text-xs bg-bg-deep border border-gold/50 hover:border-gold rounded px-2.5 py-1.5 text-text"
                data-testid="cli-refusal-open-page"
              >
                {s("refusalOpenPage", locale)}
              </a>
            )}
            {turn.refusal.requestCapability && (
              <button
                type="button"
                onClick={() =>
                  // Task #340 — one-click feature-request capture: submit
                  // the request_feature command directly instead of just
                  // pre-filling the input box.
                  onRequestCapability(turn.refusal!.requestCapability!.prompt)
                }
                className="text-xs bg-bg-deep border border-warning/50 hover:border-warning rounded px-2.5 py-1.5 text-text"
                data-testid="cli-refusal-request"
              >
                {s("refusalRequest", locale)}
              </button>
            )}
          </div>
        </div>
      )}

      {turn.disambig && turn.status === "needs_disambiguation" && (
        <div
          className="bg-bg-elevate border border-gold/40 rounded-md p-3 space-y-2"
          data-testid="cli-disambig"
        >
          <div className="text-xs font-mono uppercase tracking-wider text-gold">
            {s("pickOne", locale)}
          </div>
          <div className="flex flex-col gap-1.5">
            {turn.disambig.options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onPickDisambig(opt.id, opt.label)}
                className="text-start bg-bg-deep hover:bg-bg-elevate-2 border border-border hover:border-gold/50 rounded px-3 py-2 text-xs transition-colors"
                data-testid="cli-disambig-option"
              >
                <div className="font-medium">{opt.label}</div>
                {opt.hint && <div className="text-xs text-text-faint">{opt.hint}</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Task #573 — a single-step plan is just a restatement of the one
          action being confirmed below; only show the plan card for genuine
          multi-step (bulk) plans. */}
      {turn.proposedPlan && turn.proposedPlan.length > 1 && (
        <PlanCard
          plan={turn.proposedPlan}
          excluded={turn.excludedStepIndexes ?? []}
          planEdits={turn.planEdits ?? {}}
          locale={locale}
          showAll={showAllSteps}
          setShowAll={setShowAllSteps}
          editingRow={editingPlanRow}
          setEditingRow={setEditingPlanRow}
          onToggleStep={onToggleStep}
          onSetRowEdit={onSetRowEdit}
          isReadOnly={!isCurrent || turn.status !== "needs_confirmation"}
        />
      )}

      {turn.status === "needs_confirmation" && turn.pending && isCurrent && (
        <div
          className="bg-bg-elevate border border-gold rounded-md p-3 space-y-2.5"
          data-testid="cli-confirm-card"
        >
          <div className="text-xs">{turn.pending.summary}</div>
          {/* Task #573 — dependency-impact summary for destructive deletes.
              `diff.impact` is only present on delete proposals; for non-empty
              dependency lists we tell the user exactly what stays behind but
              loses its link, so a delete is never a silent surprise. */}
          {(() => {
            const diff = turn.pending.diff as Record<string, unknown> | null | undefined;
            const impact = diff?.impact as
              | { dependencies?: Array<{ kind: string; count: number }>; total?: number }
              | undefined;
            if (!impact) return null;
            const deps = (impact.dependencies ?? []).filter((d) => d.count > 0);
            const impactLabel = (kind: string): string => {
              switch (kind) {
                case "opportunity":
                  return s("impactOpportunity", locale);
                case "engagement":
                  return s("impactEngagement", locale);
                case "contact":
                  return s("impactContact", locale);
                case "invoice":
                  return s("impactInvoice", locale);
                case "contact_relationship":
                  return s("impactContactRelationship", locale);
                default:
                  return kind;
              }
            };
            return (
              <div
                className="bg-bg-deep border border-gold/30 rounded p-2 space-y-1"
                data-testid="cli-impact"
              >
                <div className="text-[10px] font-mono uppercase tracking-wider text-gold">
                  {s("impactTitle", locale)}
                </div>
                {deps.length === 0 ? (
                  <div className="text-[11px] text-text-mute">{s("impactNone", locale)}</div>
                ) : (
                  <>
                    <div className="text-[11px] text-text-mute">{s("impactRetained", locale)}</div>
                    <ul className="text-[11px] text-text space-y-0.5">
                      {deps.map((d) => (
                        <li key={d.kind} data-testid="cli-impact-row">
                          · {d.count} {impactLabel(d.kind)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            );
          })()}
          {turn.pending.typedNameRequired && (
            <div className="space-y-1">
              <label
                htmlFor="cli-typed-name"
                className="text-xs font-mono uppercase tracking-wider text-danger"
              >
                {s("typedNameLabel", locale)}
              </label>
              <input
                id="cli-typed-name"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder={turn.pending.typedNameRequired}
                className="w-full bg-bg-deep border border-danger/50 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-danger"
                data-testid="cli-typed-name-input"
              />
              {typedName && typedName.trim() !== turn.pending.typedNameRequired.trim() && (
                <div className="text-[11px] text-danger" data-testid="cli-typed-name-mismatch">
                  {s("typedNameMismatch", locale)}
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirm}
              // Task #24 — disabled while the confirm request is in
              // flight so a double-click can't fire twice, with a
              // visible "Confirming…" state.
              disabled={
                confirming ||
                (!!turn.pending.typedNameRequired &&
                  typedName.trim() !== turn.pending.typedNameRequired.trim())
              }
              aria-busy={confirming}
              className="inline-flex items-center gap-1.5 bg-gold text-bg-deep font-semibold text-xs px-3 py-1.5 rounded hover:bg-gold/90 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="cli-confirm"
            >
              {confirming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {confirming ? s("confirming", locale) : s("confirm", locale)}
            </button>
            <button
              type="button"
              // Task #573 — Edit cancels the pending write and drops the
              // user's original prompt back into the composer so they can
              // adjust and re-run it. Previously it opened a non-existent
              // plan-row editor (no single-step plan card is rendered),
              // making the button a dead end.
              onClick={() => {
                onCancelTurn();
                onPickSuggestion(turn.prompt);
              }}
              title={s("editHint", locale)}
              className="text-xs text-text-mute hover:text-text px-3 py-1.5 rounded hover:bg-bg-elevate-2"
              data-testid="cli-edit"
            >
              {s("edit", locale)}
            </button>
            <button
              type="button"
              onClick={onCancelTurn}
              disabled={confirming}
              className="text-xs text-text-mute hover:text-danger px-3 py-1.5 rounded hover:bg-bg-elevate-2 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="cli-cancel"
            >
              {s("cancel", locale)}
            </button>
            <span className="ml-auto text-[10px] font-mono text-text-faint">⌘↩</span>
          </div>
        </div>
      )}

      {turn.status === "async_handoff" && turn.asyncJob && (
        <div
          className="bg-bg-elevate border border-gold/40 rounded-md p-3 flex items-start gap-2"
          data-testid="cli-async-handoff"
        >
          <Clock className="w-4 h-4 text-gold mt-0.5 shrink-0" />
          <div className="flex-1 text-xs">
            {s("asyncHandoff", locale)}
            <div className="text-[11px] font-mono text-text-faint mt-1">
              job {turn.asyncJob.jobId}
            </div>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-gold bg-bg-deep border border-gold/40 px-1.5 py-0.5 rounded">
            {s("asyncBadge", locale)}
          </span>
        </div>
      )}

      {turn.status === "partial" && turn.partial && (
        <div
          className="bg-danger/10 border border-danger/40 rounded-md p-3 space-y-2"
          data-testid="cli-partial"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
            <div className="text-xs">
              {sFmt("partialBanner", locale, { n: turn.partial.failedStepIndex + 1 })}
              <div className="text-xs font-mono text-danger mt-1">{turn.partial.error}</div>
            </div>
          </div>
          {/* Per-step status. The orchestrator may emit `stepResults` on
              the partial_success frame (forward-safe optional field).
              Falls back to deriving green/red from `failedStepIndex` so
              this state is always rendered, even before the server
              starts populating per-step records. */}
          {turn.proposedPlan && turn.proposedPlan.length > 0 && (
            <ul
              className="space-y-0.5 text-xs"
              data-testid="cli-partial-steps"
            >
              {turn.proposedPlan.map((step, i) => {
                const sr = turn.partial!.stepResults?.find((x) => x.index === i);
                const derivedStatus: "success" | "error" | "pending" | "skipped" = sr
                  ? sr.status
                  : i < turn.partial!.failedStepIndex
                    ? "success"
                    : i === turn.partial!.failedStepIndex
                      ? "error"
                      : "skipped";
                const dot =
                  derivedStatus === "success"
                    ? "bg-success"
                    : derivedStatus === "error"
                      ? "bg-danger"
                      : derivedStatus === "skipped"
                        ? "bg-text-faint"
                        : "bg-warning";
                return (
                  <li
                    key={i}
                    className="flex items-start gap-2"
                    data-testid="cli-partial-step"
                    data-step-status={derivedStatus}
                  >
                    <span className={cn("w-1.5 h-1.5 mt-1.5 rounded-full shrink-0", dot)} />
                    <span className="font-mono text-text-faint shrink-0">{i + 1}.</span>
                    <span className="flex-1 leading-snug">{step.label}</span>
                    {sr?.error && (
                      <span className="text-[10px] font-mono text-danger" title={sr.error}>
                        ⚠
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPickSuggestion(`Resume the previous turn from step ${turn.partial!.failedStepIndex + 1}`)}
              className="text-xs bg-bg-elevate border border-border hover:border-gold/50 rounded px-2 py-1"
              data-testid="cli-resume"
            >
              {s("resume", locale)}
            </button>
            <button
              type="button"
              onClick={() => onPickSuggestion("Rollback the partially-completed turn")}
              className="text-xs bg-bg-elevate border border-border hover:border-gold/50 rounded px-2 py-1"
              data-testid="cli-rollback"
            >
              {s("rollback", locale)}
            </button>
          </div>
        </div>
      )}

      {turn.status === "error" && turn.error && (
        <div
          className="bg-danger/10 border border-danger/40 rounded-md p-3 flex items-start gap-2"
          data-testid="cli-error"
        >
          <XCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
          <div className="flex-1 text-xs">
            <div className="font-mono text-xs uppercase tracking-wider text-danger mb-0.5">
              {s("errorBadge", locale)} · {turn.error.code}
            </div>
            {turn.error.message}
          </div>
        </div>
      )}

      {turn.status === "cancelled" && (
        <div
          className="text-xs font-mono text-text-faint italic"
          data-testid="cli-cancelled"
        >
          {s("cancelled", locale)}
        </div>
      )}

      {/* Task #348 — render real result-card visualisations from the
          captured tool_result payloads. Sits above the summary card so
          the chart is the first thing the user reads. Hidden while the
          turn is still mid-stream so half-arrived data doesn't flash. */}
      {turn.toolResults && turn.toolResults.length > 0 &&
        turn.status !== "idle" &&
        turn.status !== "streaming" && (
          <ToolResultCardList
            toolResults={turn.toolResults}
            capabilities={capabilities}
            locale={locale}
            onPickDisambig={onPickDisambig}
            onRunSlash={(cmd) => onPickSuggestion(cmd)}
          />
        )}

      {turn.result && (turn.status === "complete" || turn.status === "partial") && (
        <ResultCard
          result={turn.result}
          locale={locale}
          onCopyJson={onCopyJson}
          onCopyMarkdown={onCopyMarkdown}
          onExport={onExport}
          onSaveShortcut={onSaveShortcut}
          onFollowUp={onPickSuggestion}
        />
      )}
    </div>
  );
}

function ClarificationCard({
  clarification,
  locale,
  onSubmit,
  onCancel,
}: {
  clarification: CliClarification;
  locale: CliLocale;
  onSubmit: (answer: string) => void;
  onCancel: () => void;
}) {
  const [answer, setAnswer] = useState("");
  return (
    <div
      className="bg-bg-elevate border border-gold/50 rounded-md p-3 space-y-2.5"
      data-testid="cli-clarification"
    >
      <div className="text-xs font-mono uppercase tracking-wider text-gold">
        {s("clarificationTitle", locale)}
        {clarification.tool && (
          <span className="ml-2 text-text-faint normal-case">
            · {clarification.tool}
          </span>
        )}
      </div>
      <div className="text-xs text-text leading-relaxed">
        {clarification.question}
      </div>
      {clarification.suggestions && clarification.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {clarification.suggestions.map((sg) => (
            <button
              key={sg.id}
              type="button"
              onClick={() => onSubmit(sg.label)}
              className="text-xs bg-bg-deep border border-border hover:border-gold/50 rounded px-2 py-1"
              data-testid="cli-clarification-suggestion"
              title={sg.hint}
            >
              {sg.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && answer.trim()) {
              e.preventDefault();
              onSubmit(answer.trim());
            }
          }}
          placeholder={clarification.field}
          className="flex-1 bg-bg-deep border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gold"
          data-testid="cli-clarification-input"
        />
        <button
          type="button"
          onClick={() => answer.trim() && onSubmit(answer.trim())}
          disabled={!answer.trim()}
          className="text-xs bg-gold text-bg-deep font-semibold px-3 py-1.5 rounded disabled:opacity-50"
          data-testid="cli-clarification-submit"
        >
          {s("clarificationSubmit", locale)}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-text-mute hover:text-danger px-2 py-1.5 rounded hover:bg-bg-elevate-2"
        >
          {s("cancel", locale)}
        </button>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  excluded,
  planEdits,
  locale,
  showAll,
  setShowAll,
  editingRow,
  setEditingRow,
  onToggleStep,
  onSetRowEdit,
  isReadOnly,
}: {
  plan: import("./types").CliPlanStep[];
  excluded: number[];
  planEdits: Record<number, string>;
  locale: CliLocale;
  showAll: boolean;
  setShowAll: (v: boolean) => void;
  editingRow: number | null;
  setEditingRow: (n: number | null) => void;
  onToggleStep: (i: number) => void;
  onSetRowEdit: (i: number, label: string) => void;
  isReadOnly: boolean;
}) {
  const isBulk = plan.length > 20;
  const visibleSteps = isBulk && !showAll ? plan.slice(0, 5) : plan;
  return (
    <div
      className="bg-bg-elevate border border-border rounded-md p-3 space-y-2"
      data-testid="cli-plan-card"
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono uppercase tracking-wider text-gold">
          {s("proposedPlan", locale)}
        </div>
        {isBulk && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-text-mute hover:text-gold inline-flex items-center gap-1"
            data-testid="cli-plan-toggle-all"
          >
            {showAll ? s("collapseAll", locale) : s("showAll", locale)}
            {showAll ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
      </div>
      {isBulk && !showAll && (
        <div className="text-xs text-text-mute" data-testid="cli-plan-bulk-summary">
          {sFmt("bulkSummary", locale, { n: plan.length })}
        </div>
      )}
      <div className="space-y-1">
        {visibleSteps.map((step, i) => {
          const isExcluded = excluded.includes(i);
          return (
            <div
              key={i}
              className={cn(
                "flex items-start gap-2 text-xs py-1 border-b border-border-soft last:border-0",
                isExcluded && "opacity-50 line-through",
              )}
              data-testid="cli-plan-row"
            >
              {!isReadOnly && (
                <input
                  type="checkbox"
                  checked={!isExcluded}
                  onChange={() => onToggleStep(i)}
                  className="mt-1 accent-gold"
                  aria-label={`Include step ${i + 1}`}
                  data-testid="cli-plan-row-toggle"
                />
              )}
              <span className="text-text-faint font-mono text-xs mt-0.5 shrink-0">
                {i + 1}.
              </span>
              {!isReadOnly && editingRow === i ? (
                <input
                  type="text"
                  defaultValue={planEdits[i] ?? step.label}
                  autoFocus
                  onBlur={(e) => {
                    onSetRowEdit(i, e.currentTarget.value);
                    setEditingRow(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onSetRowEdit(i, (e.target as HTMLInputElement).value);
                      setEditingRow(null);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingRow(null);
                    }
                  }}
                  className="flex-1 bg-bg-deep border border-gold/50 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-gold"
                  data-testid="cli-plan-row-edit"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => !isReadOnly && setEditingRow(i)}
                  disabled={isReadOnly}
                  className={cn(
                    "flex-1 text-start leading-snug",
                    !isReadOnly && "hover:bg-bg-elevate-2 rounded px-1 cursor-text",
                  )}
                  title={isReadOnly ? undefined : "Click to edit"}
                  data-testid="cli-plan-row-label"
                >
                  {planEdits[i] ?? step.label}
                  {planEdits[i] !== undefined && (
                    <span
                      className="ml-1 text-[10px] font-mono text-gold"
                      title="edited"
                      data-testid="cli-plan-row-edited"
                    >
                      ✎
                    </span>
                  )}
                </button>
              )}
              {step.isWrite && (
                <span className="text-[10px] font-mono text-gold" title="write">
                  ✎
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultCard({
  result,
  locale,
  onCopyJson,
  onCopyMarkdown,
  onExport,
  onSaveShortcut,
  onFollowUp,
}: {
  result: import("./types").CliResultCard;
  locale: CliLocale;
  onCopyJson: () => void;
  onCopyMarkdown: () => void;
  onExport: () => void;
  onSaveShortcut: () => void;
  onFollowUp: (text: string) => void;
}) {
  return (
    <div
      className="bg-bg-elevate border border-success/40 rounded-md p-3 space-y-2.5"
      data-testid="cli-result"
    >
      <div className="flex items-start gap-2">
        <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-xs font-semibold">{result.title}</div>
          {result.summary && (
            <div className="text-xs text-text-mute mt-1">{result.summary}</div>
          )}
        </div>
      </div>
      {result.entities && result.entities.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
            {s("resultEntities", locale)}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {result.entities.map((e) => (
              <a
                key={`${e.kind}-${e.id}`}
                href={e.href ?? "#"}
                className="inline-flex items-center gap-1 text-xs bg-bg-deep border border-border hover:border-gold/50 hover:text-gold rounded px-2 py-0.5"
                data-testid="cli-result-entity"
              >
                <span className="font-mono text-text-faint">{e.kind}</span>
                <span>{e.label}</span>
                {e.href && <ExternalLink className="w-3 h-3" />}
              </a>
            ))}
          </div>
        </div>
      )}
      {result.followUps && result.followUps.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
            {s("followUps", locale)}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {result.followUps.slice(0, 3).map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onFollowUp(f.prompt)}
                className="text-xs bg-gold/10 border border-gold/30 hover:bg-gold/20 text-text rounded-full px-3 py-1"
                data-testid="cli-followup-chip"
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-border-soft">
        {result.auditEventId && (
          <a
            href={`/admin?audit=${encodeURIComponent(result.auditEventId)}`}
            className="text-[11px] font-mono text-text-mute hover:text-gold inline-flex items-center gap-1 px-1.5 py-1"
            data-testid="cli-result-audit"
          >
            <ExternalLink className="w-3 h-3" />
            {s("viewAudit", locale)}
          </a>
        )}
        {result.agentRunIds?.map((id) => (
          <a
            key={id}
            href={`/agents/run/${encodeURIComponent(id)}`}
            className="text-[11px] font-mono text-text-mute hover:text-gold inline-flex items-center gap-1 px-1.5 py-1"
            data-testid="cli-result-agentrun"
          >
            <ExternalLink className="w-3 h-3" />
            {s("viewAgentRun", locale)}
          </a>
        ))}
        <span className="ml-auto inline-flex items-center gap-0.5">
          <button
            type="button"
            onClick={onCopyMarkdown}
            className="text-text-mute hover:text-gold p-1 rounded hover:bg-bg-elevate-2"
            title={s("copyMarkdown", locale)}
            data-testid="cli-action-copy-md"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onCopyJson}
            className="text-text-mute hover:text-gold p-1 rounded hover:bg-bg-elevate-2 text-[10px] font-mono"
            title={s("copyJson", locale)}
            data-testid="cli-action-copy-json"
          >
            {"{ }"}
          </button>
          <button
            type="button"
            onClick={onExport}
            className="text-text-mute hover:text-gold p-1 rounded hover:bg-bg-elevate-2"
            title={s("exportTranscript", locale)}
            data-testid="cli-action-export"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() =>
              onFollowUp(
                locale === "ar"
                  ? "جدول هذا الأمر ليتكرر أسبوعيًا"
                  : "Schedule this to run every week",
              )
            }
            className="text-text-mute hover:text-gold p-1 rounded hover:bg-bg-elevate-2"
            title={locale === "ar" ? "جدولة متكرّرة" : "Schedule recurring"}
            data-testid="cli-action-schedule"
          >
            <Clock className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onSaveShortcut}
            className="text-text-mute hover:text-gold p-1 rounded hover:bg-bg-elevate-2"
            title={s("saveAsShortcut", locale)}
            data-testid="cli-action-save"
          >
            <Save className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>
    </div>
  );
}

/* ──────────────────────────── /help ──────────────────────────── */

/* ────────────────────────── Context Panel ───────────────────────── */
/**
 * Right-side rail shown inside the CLI dialog. Renders the current
 * surface and any active record IDs derived from the route by
 * `pageContext.ts`. Hidden on narrow viewports to preserve the mobile
 * full-bleed experience.
 */
function ContextPanel({
  pageCtx,
  locale,
}: {
  pageCtx: import("./pageContext").DerivedPageContext;
  locale: CliLocale;
}) {
  const rows: Array<{ k: string; v: string }> = [];
  if (pageCtx.activeAccountId) rows.push({ k: "account", v: pageCtx.activeAccountId });
  if (pageCtx.activeOpportunityId) rows.push({ k: "opportunity", v: pageCtx.activeOpportunityId });
  if (pageCtx.activeEngagementId) rows.push({ k: "engagement", v: pageCtx.activeEngagementId });
  if (pageCtx.activePersonId) rows.push({ k: "person", v: pageCtx.activePersonId });
  if (pageCtx.activeExpenseId) rows.push({ k: "expense", v: pageCtx.activeExpenseId });
  if (pageCtx.activeAgentId) rows.push({ k: "agent", v: pageCtx.activeAgentId });
  return (
    <aside
      className="hidden md:flex flex-col w-48 shrink-0 border-s border-border-soft bg-bg-elevate/40 p-3 gap-3 overflow-y-auto"
      data-testid="cli-context-panel"
    >
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
          {locale === "ar" ? "السياق" : "context"}
        </div>
        <div className="text-xs font-mono text-gold" data-testid="cli-context-surface">
          {pageCtx.surface}
        </div>
        <div
          className="text-[11px] font-mono text-text-mute mt-0.5 truncate"
          title={pageCtx.currentPath}
        >
          {pageCtx.currentPath}
        </div>
      </div>
      {rows.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint">
            {locale === "ar" ? "السجلات النشطة" : "active records"}
          </div>
          {rows.map((r) => (
            <div
              key={r.k}
              className="bg-bg-deep border border-border rounded px-1.5 py-1"
              data-testid="cli-context-record"
              data-record-kind={r.k}
            >
              <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint">
                {r.k}
              </div>
              <div className="text-[11px] font-mono text-text truncate" title={r.v}>
                {r.v}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-text-faint italic mt-auto leading-snug">
        {locale === "ar"
          ? "سيستخدم المنسّق هذا السياق لربط 'هذا' أو 'الفرصة الحاليّة'."
          : 'The orchestrator uses this context to resolve "this" or "the current opp".'}
      </div>
    </aside>
  );
}

/**
 * Lift a server-side turn row (from /cli/sessions/:id) into the
 * CliTurn shape the transcript renders. Walks `frames` defensively
 * because the orchestrator stores them verbatim.
 */
function rowToHistoricalTurn(row: Record<string, unknown>): CliTurn {
  const status = String(row.status ?? "success");
  const mappedStatus: CliTurn["status"] =
    status === "success"
      ? "complete"
      : status === "partial"
        ? "partial"
        : status === "error"
          ? "error"
          : status === "cancelled"
            ? "cancelled"
            : status === "awaiting_confirmation"
              ? "needs_confirmation"
              : status === "async_dispatched"
                ? "async_handoff"
                : "complete";
  let result: CliTurn["result"];
  // Task #348 — also backfill toolResults from the stored frame log so
  // historical replays render the same chart cards as live turns.
  const toolResults: NonNullable<CliTurn["toolResults"]> = [];
  const frames = row.frames;
  if (Array.isArray(frames)) {
    for (const f of frames) {
      const fr = f as {
        type?: string;
        data?: {
          result?: CliTurn["result"];
          tool?: string;
          ok?: boolean;
          data?: unknown;
          errorCode?: string;
          errorMessage?: string;
        };
      };
      if (fr?.type === "final" && fr.data?.result) {
        result = fr.data.result;
      } else if (fr?.type === "tool_result" && fr.data) {
        toolResults.push({
          tool: fr.data.tool ?? "tool",
          ok: fr.data.ok !== false,
          data: fr.data.data,
          errorCode: fr.data.errorCode,
          errorMessage: fr.data.errorMessage,
        });
      }
    }
  }
  const stepResults = (row.stepResults as
    | Array<{
        index: number;
        status: "success" | "error" | "skipped" | "pending";
        error?: string | null;
      }>
    | null
    | undefined) ?? undefined;
  return {
    clientTurnKey: `historical:${row.id}`,
    serverTurnId: String(row.id ?? ""),
    prompt: String(row.prompt ?? ""),
    status: mappedStatus,
    startedAt: row.createdAt ? new Date(String(row.createdAt)).getTime() : Date.now(),
    trace: [],
    result,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    partial:
      mappedStatus === "partial"
        ? {
            completedSteps: 0,
            failedStepIndex: -1,
            error: "(see transcript)",
            stepResults,
          }
        : undefined,
  };
}

function HelpPanel({
  capabilities,
  error,
  locale,
}: {
  capabilities: CliCapability[];
  error: string | null;
  locale: CliLocale;
}) {
  const grouped = React.useMemo(() => {
    const map = new Map<string, CliCapability[]>();
    for (const c of capabilities) {
      const arr = map.get(c.module) ?? [];
      arr.push(c);
      map.set(c.module, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [capabilities]);
  return (
    <div className="p-4 space-y-3" data-testid="cli-help">
      <div>
        <div className="text-xs font-semibold">{s("helpTitle", locale)}</div>
        <div className="text-xs text-text-faint mt-0.5">{s("helpHint", locale)}</div>
      </div>
      {error && (
        <div className="text-xs text-danger" data-testid="cli-help-error">
          {error}
        </div>
      )}
      {grouped.length === 0 && !error && (
        <div className="text-xs text-text-faint italic">No capabilities exposed for your role.</div>
      )}
      {grouped.map(([module, caps]) => (
        <div key={module} className="space-y-1.5">
          <div className="text-[11px] font-mono uppercase tracking-wider text-gold">
            {module}
          </div>
          <div className="space-y-1">
            {caps.map((c) => (
              <div
                key={c.id}
                className="bg-bg-elevate border border-border rounded p-2"
                data-testid="cli-help-row"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-gold">
                    /{c.slashAliases[locale]?.[0] ?? c.slashAliases.en?.[0] ?? c.toolName}
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-text-faint">
                    {c.irreversible ? "⚠ irreversible" : c.isWrite ? "✎ write" : "read"}
                  </span>
                </div>
                <div className="text-xs text-text-mute mt-1">{c.description}</div>
                {(() => {
                  const ex =
                    c.examplePhrases?.[locale] ?? c.examplePhrases?.en ?? [];
                  if (ex.length === 0) return null;
                  return (
                    <ul
                      className="mt-1.5 space-y-0.5 list-disc list-inside text-[11px] text-text-faint italic"
                      data-testid="cli-help-examples"
                    >
                      {ex.slice(0, 3).map((p, i) => (
                        <li key={i}>"{p}"</li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── Saved drawer ───────────────────────── */

function SavedPanel({
  prompts,
  currentSchemaVersion,
  locale,
  onRun,
  onDelete,
}: {
  prompts: SavedPrompt[];
  currentSchemaVersion: number;
  locale: CliLocale;
  onRun: (p: SavedPrompt) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="p-4 space-y-3" data-testid="cli-saved">
      <div className="text-xs font-semibold">{s("savedDrawerTitle", locale)}</div>
      {prompts.length === 0 ? (
        <div className="text-xs text-text-faint italic">{s("savedDrawerEmpty", locale)}</div>
      ) : (
        <div className="space-y-2">
          {prompts.map((p) => {
            const stale = p.schemaVersionAtSave !== currentSchemaVersion;
            return (
              <div
                key={p.id}
                className="bg-bg-elevate border border-border rounded p-2.5 text-xs"
                data-testid="cli-saved-row"
              >
                <div className="font-medium leading-snug">{p.label}</div>
                <div className="text-xs text-text-mute mt-1 line-clamp-2">{p.prompt}</div>
                {stale && (
                  <div
                    className="mt-1.5 text-[11px] text-warning bg-warning/10 border border-warning/30 rounded px-2 py-1"
                    data-testid="cli-saved-stale"
                  >
                    ⚠ {s("savedSchemaWarning", locale)}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onRun(p)}
                    className="text-xs bg-gold text-bg-deep font-semibold px-2 py-1 rounded hover:bg-gold/90 inline-flex items-center gap-1"
                    data-testid="cli-saved-run"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {s("savedRun", locale)}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(p.id)}
                    className="text-xs text-text-mute hover:text-danger px-2 py-1 rounded hover:bg-bg-elevate-2 inline-flex items-center gap-1"
                    data-testid="cli-saved-delete"
                  >
                    <Trash2 className="w-3 h-3" />
                    {s("savedDelete", locale)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── prefers-reduced-motion ───────────────────────── */

function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState<boolean>(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}
