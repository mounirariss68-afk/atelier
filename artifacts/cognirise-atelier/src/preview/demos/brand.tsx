import { Guidelines, Stack } from '../parts';

const BASE = import.meta.env.BASE_URL;

function Swatch({ hex, name }: { hex: string; name: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-8 w-8 rounded-md border border-border"
        style={{ background: hex }}
      />
      <div className="text-xs">
        <div className="font-semibold">{name}</div>
        <div className="font-mono text-muted-foreground">{hex}</div>
      </div>
    </div>
  );
}

export function BrandDemo() {
  return (
    <div className="space-y-10">
      <Stack label="Accent gradient — the Cognirise signature">
        <div
          className="h-16 rounded-xl"
          style={{ background: 'var(--cog-grad)' }}
        />
        <div className="flex flex-wrap gap-6">
          <Swatch hex="#5B7CFF" name="Blue" />
          <Swatch hex="#8A5BD6" name="Purple" />
          <Swatch hex="#C45BB8" name="Magenta (primary)" />
          <Swatch hex="#FF7B5A" name="Coral (accent)" />
        </div>
        <span className="section-divider" />
        <p className="text-sm text-muted-foreground">
          Use the full gradient sparingly: the 48×3 section divider above, thin
          rules, and small fills. Solid accents come from the token roles
          (primary = magenta, secondary = purple, accent = coral).
        </p>
      </Stack>

      <Stack label="Logo lockups">
        <div className="flex flex-wrap items-center gap-6">
          <div className="rounded-xl p-6" style={{ background: '#0A1230' }}>
            <img src={`${BASE}cognirise-logo.png`} alt="Cognirise lockup (light wordmark, for navy surfaces)" className="h-11" />
          </div>
          <div className="rounded-xl border border-border bg-white p-6">
            <img src={`${BASE}cognirise-logo-light.png`} alt="Cognirise lockup (navy ink, for light surfaces)" className="h-11" />
          </div>
          <div className="rounded-xl border border-border p-6">
            <img src={`${BASE}cognirise-mark.png`} alt="Cognirise gradient mark" className="h-11" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Light wordmark on navy surfaces; navy-ink wordmark on light/white
          surfaces (reports, print); the gradient “C” mark reads on any
          background. Files live in <code>docs/references/logos/</code>.
        </p>
      </Stack>

      <Stack label="Wordmark face">
        <p className="text-3xl">
          Cognirise <em className="accent font-wordmark">Atelier</em>
        </p>
        <p className="text-sm text-muted-foreground">
          Comfortaa (via <code>.font-wordmark</code>, weight 700) draws brand
          wordmarks and all headings — it echoes the rounded dotted-C logo
          lettering. Body copy, labels, buttons, stats, and captions are Inter
          (400/600/800).
        </p>
      </Stack>

      <Stack label="Backdrop artwork">
        <div className="grid gap-4 sm:grid-cols-2">
          <figure className="space-y-2">
            <img src={`${BASE}dark-bg.webp`} alt="Dark navy network-wave backdrop" className="rounded-xl border border-border" />
            <figcaption className="text-xs text-muted-foreground">
              dark-bg.webp — dark theme wallpaper
            </figcaption>
          </figure>
          <figure className="space-y-2">
            <img src={`${BASE}light-bg-wave.webp`} alt="Pale blue-to-coral wave backdrop" className="rounded-xl border border-border" />
            <figcaption className="text-xs text-muted-foreground">
              light-bg-wave.webp — light theme wallpaper
            </figcaption>
          </figure>
        </div>
        <p className="text-sm text-muted-foreground">
          Layering (bottom → top): <code>.cog-backdrop</code> on the body paints
          a fixed 160° gradient fallback; a fixed <code>.cog-backdrop-art</code>
          div carries the wallpaper; glass surfaces blur over it. See
          <code> docs/references/README.md</code>.
        </p>
      </Stack>

      <Guidelines
        items={[
          { kind: 'do', text: 'Keep the app on the fixed navy/off-white backdrop so glass surfaces have something to blur.' },
          { kind: 'do', text: 'Use the gradient for thin rules and dividers; use solid token accents for interactive color.' },
          { kind: 'dont', text: 'Do not recolor or redraw the logos, and never place the light wordmark on a pale surface.' },
          { kind: 'dont', text: 'Do not use Comfortaa for body copy — it is for headings, display text, and the wordmark only (weights 400/700; never synthesize 600).' },
        ]}
      />
    </div>
  );
}
