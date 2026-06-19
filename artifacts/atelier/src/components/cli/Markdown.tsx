import * as React from "react";
import { cn } from "@/lib/utils";

interface ListItem {
  text: string;
  child?: ListNode;
}
interface ListNode {
  ordered: boolean;
  items: ListItem[];
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "list"; node: ListNode }
  | { kind: "table"; header: string[]; align: ("left" | "right" | "center")[]; rows: string[][] };

const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

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
    // Heading (# … ######)
    const hm = line.match(HEADING_RE);
    if (hm) {
      flushPara();
      blocks.push({ kind: "h", level: hm[1].length, text: hm[2].trim() });
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
    // List (bullet or numbered, with nesting via indentation)
    if (LIST_ITEM_RE.test(line)) {
      flushPara();
      const { node, next } = parseList(lines, i);
      blocks.push({ kind: "list", node });
      i = next;
      continue;
    }
    buf.push(line.trim());
    i++;
  }
  flushPara();
  return blocks;
}

interface FlatEntry {
  indent: number;
  ordered: boolean;
  text: string;
}

/** Consume a contiguous run of list lines and build a nested tree from
 * their leading indentation (tabs count as two spaces). */
function parseList(lines: string[], start: number): { node: ListNode; next: number } {
  const flat: FlatEntry[] = [];
  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(LIST_ITEM_RE);
    if (!m) break;
    flat.push({
      indent: m[1].replace(/\t/g, "  ").length,
      ordered: /\d/.test(m[2]),
      text: m[3].trim(),
    });
    i++;
  }
  const { node } = buildTree(flat, 0, flat[0]?.indent ?? 0);
  return { node, next: i };
}

function buildTree(
  flat: FlatEntry[],
  pos: number,
  baseIndent: number,
): { node: ListNode; pos: number } {
  const items: ListItem[] = [];
  const ordered = flat[pos]?.ordered ?? false;
  while (pos < flat.length && flat[pos].indent >= baseIndent) {
    const e = flat[pos];
    if (e.indent > baseIndent) {
      // Deeper — attach as a child of the previous sibling.
      const sub = buildTree(flat, pos, e.indent);
      if (items.length > 0) items[items.length - 1].child = sub.node;
      else items.push({ text: "", child: sub.node });
      pos = sub.pos;
    } else {
      items.push({ text: e.text });
      pos++;
    }
  }
  return { node: { ordered, items }, pos };
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

const HEADING_CLASS: Record<number, string> = {
  1: "text-sm font-semibold text-text mt-1",
  2: "text-[13px] font-semibold text-text mt-1",
  3: "text-xs font-semibold text-text",
  4: "text-[11px] font-semibold uppercase tracking-wider text-text-mute",
  5: "text-[11px] font-semibold uppercase tracking-wider text-text-faint",
  6: "text-[10px] font-semibold uppercase tracking-wider text-text-faint",
};

function MdHeading({ level, text, keyBase }: { level: number; text: string; keyBase: string }) {
  const Tag = `h${Math.min(level, 6)}` as React.ElementType;
  return (
    <Tag className={HEADING_CLASS[level] ?? HEADING_CLASS[6]}>
      {renderInline(text, keyBase)}
    </Tag>
  );
}

function MdList({ node, keyBase }: { node: ListNode; keyBase: string }) {
  const Tag = node.ordered ? "ol" : "ul";
  return (
    <Tag className={cn(node.ordered ? "list-decimal" : "list-disc", "ms-5 space-y-0.5")}>
      {node.items.map((it, j) => (
        <li key={j}>
          {it.text && renderInline(it.text, `${keyBase}-${j}`)}
          {it.child && <MdList node={it.child} keyBase={`${keyBase}-${j}c`} />}
        </li>
      ))}
    </Tag>
  );
}

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
        if (b.kind === "h")
          return <MdHeading key={i} level={b.level} text={b.text} keyBase={`h${i}`} />;
        if (b.kind === "list")
          return <MdList key={i} node={b.node} keyBase={`l${i}`} />;
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
