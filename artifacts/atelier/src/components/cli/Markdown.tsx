import * as React from "react";
import { cn } from "@/lib/utils";

type Block =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; header: string[]; align: ("left" | "right" | "center")[]; rows: string[][] };

const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function parseAlign(cell: string): "left" | "right" | "center" {
  const t = cell.trim();
  const left = t.startsWith(":");
  const right = t.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let buf: string[] = [];
  const flushPara = () => {
    if (buf.length === 0) return;
    const text = buf.join(" ").trim();
    if (text) blocks.push({ kind: "p", text });
    buf = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }
    // Table?
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      flushPara();
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map(parseAlign);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", header, align, rows });
      continue;
    }
    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    buf.push(line.trim());
    i++;
  }
  flushPara();
  return blocks;
}

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${k++}`;
    if (m[2] !== undefined) out.push(<strong key={key}>{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<em key={key}>{m[3]}</em>);
    else if (m[4] !== undefined)
      out.push(
        <code
          key={key}
          className="px-1 py-px rounded bg-bg-deep border border-border-soft font-mono text-[11px]"
        >
          {m[4]}
        </code>,
      );
    else if (m[5] !== undefined && m[6] !== undefined) {
      const safe = /^(https?:|mailto:|\/|#)/i.test(m[6].trim());
      if (safe) {
        out.push(
          <a
            key={key}
            href={m[6]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gold hover:underline"
          >
            {m[5]}
          </a>,
        );
      } else {
        out.push(<span key={key}>{m[5]}</span>);
      }
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const ALIGN_CLASS: Record<string, string> = {
  left: "text-start",
  right: "text-end",
  center: "text-center",
};

export function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);
  return (
    <div
      className={cn(
        "text-xs text-text leading-relaxed space-y-1.5 [&_strong]:font-semibold [&_strong]:text-text",
        className,
      )}
      data-testid="cli-markdown"
    >
      {blocks.map((b, i) => {
        if (b.kind === "p")
          return (
            <p key={i} className="whitespace-pre-wrap">
              {renderInline(b.text, `p${i}`)}
            </p>
          );
        if (b.kind === "ul")
          return (
            <ul key={i} className="list-disc ms-5 space-y-0.5">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it, `ul${i}-${j}`)}</li>
              ))}
            </ul>
          );
        if (b.kind === "ol")
          return (
            <ol key={i} className="list-decimal ms-5 space-y-0.5">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it, `ol${i}-${j}`)}</li>
              ))}
            </ol>
          );
        return (
          <div key={i} className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-border">
                  {b.header.map((h, j) => (
                    <th
                      key={j}
                      className={cn(
                        "px-2 py-1 font-mono uppercase tracking-wider text-[10px] text-text-faint",
                        ALIGN_CLASS[b.align[j] ?? "left"],
                      )}
                    >
                      {renderInline(h, `th${i}-${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri} className="border-b border-border-soft last:border-b-0">
                    {r.map((c, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          "px-2 py-1 align-top",
                          ALIGN_CLASS[b.align[ci] ?? "left"],
                        )}
                      >
                        {renderInline(c, `td${i}-${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
