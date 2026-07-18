/**
 * Task #128 — visual signature-box placement editor.
 *
 * Renders the selected Document Library PDF with pdf.js and overlays
 * one draggable signature box per signer. The sender can move boxes,
 * change which page each box sits on, or reset to the automatic
 * two-column layout on the last page. Coordinates are normalized page
 * fractions (top-left origin) matching the server's DocuSeal contract.
 */

import * as React from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import {
  clampPlacement,
  defaultPlacements,
  type Placement,
} from "./placement";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const BOX_COLORS = [
  "border-sky-400 bg-sky-400/20 text-sky-200",
  "border-amber-400 bg-amber-400/20 text-amber-200",
  "border-emerald-400 bg-emerald-400/20 text-emerald-200",
  "border-fuchsia-400 bg-fuchsia-400/20 text-fuchsia-200",
  "border-rose-400 bg-rose-400/20 text-rose-200",
];

export function SignaturePlacementEditor({
  documentId,
  signerNames,
  placements,
  onChange,
}: {
  documentId: string;
  /** Signer display names in signing order (length = box count). */
  signerNames: string[];
  /** Current placements (always one per signer once the PDF loads). */
  placements: Placement[] | null;
  /**
   * Called with the full placement list whenever anything changes, and
   * once after load to seed defaults when `placements` is null.
   */
  onChange: (next: Placement[]) => void;
}) {
  const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = React.useState(0);
  const [page, setPage] = React.useState(1); // currently viewed page
  const [error, setError] = React.useState<string | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{ index: number; dx: number; dy: number } | null>(null);

  const apiBase = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

  // Load the PDF whenever the selected document changes.
  React.useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setError(null);
    setPageCount(0);
    if (!documentId) return;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/documents/${documentId}/download`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`download failed (${res.status})`);
        const bytes = await res.arrayBuffer();
        const task = pdfjsLib.getDocument({ data: bytes });
        const doc = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        setPdf(doc);
        setPageCount(doc.numPages);
        setPage(doc.numPages); // signature blocks usually live on the last page
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load the PDF preview.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Seed defaults (or repair length) once the page count is known or the
  // signer roster changes.
  React.useEffect(() => {
    if (pageCount === 0) return;
    if (!placements || placements.length !== signerNames.length) {
      onChange(defaultPlacements(signerNames.length, pageCount));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount, signerNames.length]);

  // Render the current page into the canvas.
  React.useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const p = await pdf.getPage(page);
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const containerWidth = canvas.parentElement?.clientWidth ?? 440;
      const base = p.getViewport({ scale: 1 });
      const scale = containerWidth / base.width;
      const viewport = p.getViewport({ scale });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      await p.render({ canvasContext: ctx, viewport, canvas }).promise;
    })().catch(() => {
      if (!cancelled) setError("Could not render the PDF page.");
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, page]);

  const update = (index: number, patch: Partial<Placement>) => {
    if (!placements) return;
    onChange(
      placements.map((p, i) =>
        i === index ? clampPlacement({ ...p, ...patch }, pageCount) : p,
      ),
    );
  };

  const onPointerDown = (e: React.PointerEvent, index: number) => {
    if (!overlayRef.current || !placements) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const p = placements[index];
    dragRef.current = {
      index,
      dx: (e.clientX - rect.left) / rect.width - p.x,
      dy: (e.clientY - rect.top) / rect.height - p.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    update(drag.index, {
      x: (e.clientX - rect.left) / rect.width - drag.dx,
      y: (e.clientY - rect.top) / rect.height - drag.dy,
    });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  if (error) {
    return (
      <div
        className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400"
        data-testid="text-placement-error"
      >
        Preview unavailable ({error}). The default layout — one box per signer on the
        last page — will be used.
      </div>
    );
  }
  if (!pdf) {
    return (
      <div className="rounded-md border border-border/60 bg-bg-elevate/40 px-3 py-6 text-center text-xs text-text-faint">
        Loading PDF preview…
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="editor-signature-placement">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            data-testid="button-placement-prevpage"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-xs text-text-mute tabular-nums" data-testid="text-placement-page">
            Page {page} / {pageCount}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            data-testid="button-placement-nextpage"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            onChange(defaultPlacements(signerNames.length, pageCount));
            setPage(pageCount);
          }}
          data-testid="button-placement-reset"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset to default
        </Button>
      </div>

      <div className="relative w-full overflow-hidden rounded-md border border-border bg-white">
        <canvas ref={canvasRef} className="block" />
        <div
          ref={overlayRef}
          className="absolute inset-0"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {(placements ?? []).map((p, i) =>
            p.page === page ? (
              <div
                key={i}
                role="button"
                tabIndex={0}
                onPointerDown={(e) => onPointerDown(e, i)}
                className={`absolute flex cursor-move touch-none select-none items-center justify-center rounded border-2 border-dashed text-[10px] font-medium ${BOX_COLORS[i % BOX_COLORS.length]}`}
                style={{
                  left: `${p.x * 100}%`,
                  top: `${p.y * 100}%`,
                  width: `${p.w * 100}%`,
                  height: `${p.h * 100}%`,
                }}
                title={`Drag to move — ${signerNames[i] || `Signer ${i + 1}`}`}
                data-testid={`box-placement-${i}`}
              >
                <span className="pointer-events-none truncate px-1 mix-blend-difference">
                  {i + 1}. {signerNames[i]?.trim() || `Signer ${i + 1}`}
                </span>
              </div>
            ) : null,
          )}
        </div>
      </div>

      <div className="grid gap-1">
        {(placements ?? []).map((p, i) => (
          <div
            key={i}
            className="flex items-center justify-between text-xs text-text-mute"
            data-testid={`row-placement-${i}`}
          >
            <span className="truncate">
              <span
                className={`mr-1.5 inline-block h-2 w-2 rounded-sm border ${BOX_COLORS[i % BOX_COLORS.length]}`}
              />
              {i + 1}. {signerNames[i]?.trim() || `Signer ${i + 1}`}
            </span>
            <label className="flex items-center gap-1 shrink-0">
              Page
              <select
                className="h-6 rounded border border-border bg-bg-elevate px-1 text-xs text-text outline-none"
                value={p.page}
                onChange={(e) => {
                  const target = Number(e.target.value);
                  update(i, { page: target });
                  setPage(target);
                }}
                data-testid={`select-placement-page-${i}`}
              >
                {Array.from({ length: pageCount }, (_, n) => (
                  <option key={n + 1} value={n + 1}>
                    {n + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-text-faint">
        Drag each box where that signer should sign. Boxes default to the last page.
      </p>
    </div>
  );
}
