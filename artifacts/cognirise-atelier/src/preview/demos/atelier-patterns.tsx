import { Guidelines, Stack } from '../parts';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';

const BASE = import.meta.env.BASE_URL;

export function AtelierPatternsDemo() {
  return (
    <div className="space-y-10">
      <Stack label="Glass surfaces over the backdrop">
        <div
          className="relative overflow-hidden rounded-xl border border-border p-6"
          style={{
            backgroundImage: `url(${BASE}dark-bg.webp)`,
            backgroundSize: 'cover',
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="card-hover">
              <CardHeader>
                <CardTitle>Glass card</CardTitle>
                <CardDescription>
                  color-mix fill via --glass-card-alpha + 16px blur.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-card-foreground">
                Cards frost over the fixed backdrop; hover lifts by 3px.
              </CardContent>
            </Card>
            <div className="glass-panel rounded-xl p-6">
              <p className="text-sm font-medium">Glass panel</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Thinner fill (--glass-panel-alpha) for large shell chrome:
                nav, rails, page panels.
              </p>
            </div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Blur is reserved for large surfaces. Small chips inside a glass panel
          use plain alpha fills — never nest backdrop blur.
        </p>
      </Stack>

      <Stack label='Page hero — the navy "dark island"'>
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="page-hero px-8">
            <span className="eyebrow">Finance · Q3</span>
            <h2 className="headline mt-3">
              Quarterly <em className="accent">close</em>
            </h2>
            <p className="lede mt-4">
              The hero band stays on the deep navy brand surface in both
              themes; its tokens are re-declared inside the island so text
              stays legible.
            </p>
          </div>
          <div className="bg-background p-8 text-sm text-muted-foreground">
            Page content continues on the theme background below the band.
          </div>
        </div>
      </Stack>

      <Stack label="Editorial primitives">
        <span className="eyebrow">Eyebrow label</span>
        <h3 className="section-label">Section label</h3>
        <span className="section-divider" />
        <p className="lede">
          A 540px lede paragraph with the 2px magenta left rule, used to
          introduce major sections.
        </p>
      </Stack>

      <Stack label="Pills, chips and tab nav">
        <div className="flex flex-wrap items-center gap-3">
          <button className="pill-btn pill-btn-primary">Primary pill</button>
          <button className="pill-btn pill-btn-ghost">Ghost pill</button>
          <span className="accent-pill">Stage · Qualify</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mono-chip">Neutral</span>
          <span className="mono-chip is-primary">Primary</span>
          <span className="mono-chip is-success">Success</span>
          <span className="mono-chip is-warn">Warn</span>
          <span className="mono-chip is-danger">Danger</span>
        </div>
        <nav className="tab-nav">
          <button className="tab-nav-item is-active">Overview</button>
          <button className="tab-nav-item">Activity</button>
          <button className="tab-nav-item">Documents</button>
        </nav>
        <div className="flex gap-3">
          <Button>Button (primary)</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
        </div>
      </Stack>

      <Guidelines
        items={[
          { kind: 'do', text: 'Apply .cog-backdrop to the body (plus a .cog-backdrop-art wallpaper layer) before using glass surfaces.' },
          { kind: 'do', text: 'Use the page-hero dark island for page headers so the navy brand carries into light mode.' },
          { kind: 'dont', text: 'Do not stack backdrop blur inside an already-blurred panel.' },
          { kind: 'dont', text: 'Do not hand-pick alphas — the --glass-*-alpha knobs keep every surface frosting in lockstep and power the reduced-transparency fallbacks.' },
        ]}
      />
    </div>
  );
}
