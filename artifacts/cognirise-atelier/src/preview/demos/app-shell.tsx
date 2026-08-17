import { useState } from 'react';
import { usePreviewTheme } from '../theme';
import {
  Check,
  ChevronDown,
  Monitor,
  Moon,
  Plus,
  Send,
  Sun,
} from 'lucide-react';
import { Guidelines, Stack } from '../parts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

const LENSES = ['Clients', 'People', 'Finance', 'Me'];
const MODES = [
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
  { id: 'system', label: 'System', Icon: Monitor },
] as const;

function LensPicker() {
  const [lens, setLens] = useState('Clients');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-2.5 py-1 text-sm font-medium"
          aria-label={`Lens — current: ${lens}`}
        >
          {lens}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44">
        {LENSES.map((l) => (
          <DropdownMenuItem key={l} onSelect={() => setLens(l)}>
            <span className="flex-1">{l}</span>
            {l === lens ? <Check className="h-3.5 w-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeModePicker() {
  // Live control: drives the shared preview theme (mode persists — including
  // "system", which follows the OS preference — per the documented contract).
  const { mode, setMode } = usePreviewTheme();
  const Active = MODES.find((m) => m.id === mode) ?? MODES[2];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`Theme mode: ${Active.label}`}
        >
          <Active.Icon className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-36">
        {MODES.map(({ id, label, Icon }) => (
          <DropdownMenuItem key={id} onSelect={() => setMode(id)}>
            <Icon className="h-4 w-4" />
            <span className="flex-1">{label}</span>
            {id === mode ? <Check className="h-3.5 w-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShellDemo() {
  const [draft, setDraft] = useState('');
  return (
    <div className="space-y-10">
      <Stack label="Title bar — 56px glass card">
        <div className="flex h-14 items-center gap-4 rounded-xl border border-border glass-panel px-4 shadow-lg shadow-black/10">
          <span className="font-wordmark select-none text-lg">Atelier</span>
          <div className="ml-auto flex items-center gap-4">
            <LensPicker />
            <ThemeModePicker />
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/50 bg-background/40 text-xs font-semibold">
              MA
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Wordmark left; right cluster holds the lens drop-down, the
          light/dark/system mode selector, then the 32px user avatar. The lens
          picker is a title-bar drop-down whenever an app has lenses.
        </p>
      </Stack>

      <Stack label="Chat — pinned column with bottom composer">
        <div className="flex h-80 flex-col overflow-hidden rounded-xl border border-border glass-panel">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl border border-border bg-background/50 px-3 py-1.5 text-xs leading-relaxed">
                Show me this quarter's open invoices.
              </div>
            </div>
            <div className="flex max-w-[92%] items-start gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                R
              </span>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Three invoices are open. The transcript is the only scrolling
                region — the whole chat column is pinned to the window height,
                and this composer never moves.
              </p>
            </div>
          </div>
          <div className="shrink-0 border-t border-border bg-background/20 p-3 backdrop-blur-sm">
            <div className="flex items-end gap-2">
              <button
                type="button"
                aria-label="Add attachment"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background/40 text-muted-foreground backdrop-blur-md transition-colors hover:text-primary"
              >
                <Plus className="h-4 w-4" />
              </button>
              <div className="flex min-w-0 flex-1 items-end gap-1.5 rounded-[22px] border border-border bg-background/40 pe-1.5 ps-4 py-1.5 backdrop-blur-md transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
                <textarea
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Ask anything…"
                  className="max-h-40 min-w-0 flex-1 resize-none border-none bg-transparent py-1.5 text-xs leading-relaxed placeholder:text-muted-foreground/60 focus:outline-none"
                />
                <button
                  type="button"
                  aria-label="Send"
                  disabled={!draft.trim()}
                  onClick={() => setDraft('')}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-primary/15 disabled:text-primary/70"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </Stack>

      <Guidelines
        items={[
          { kind: 'do', text: 'Pin the chat column to the window height: transcript is flex-1 min-h-0 overflow-y-auto, composer is shrink-0 at the bottom.' },
          { kind: 'do', text: 'Keep composer anatomy exact: 36px circular "+" button, 22px-radius input pill, 32px circular accent send button with a 16px icon.' },
          { kind: 'do', text: 'Put the lens drop-down and the light/dark/system selector in the title bar right cluster; System follows the OS and is the default.' },
          { kind: 'dont', text: 'Do not let the page scroll the chat, replace the lens drop-down with sidebar sections, or ship a theme control without the System option.' },
        ]}
      />
    </div>
  );
}
