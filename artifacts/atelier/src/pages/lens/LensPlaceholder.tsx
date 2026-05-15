/**
 * LensPlaceholder — empty-state home for a Manage lens (Task #368).
 *
 * The five lenses (Clients, People, Agents, Partners, Finance) ship in
 * follow-up tasks. Until each one's home page lands, navigating to the
 * lens prefix lands here so the picker, deep links and persistence still
 * resolve to a real page.
 */

import { Eyebrow, PageHero } from "@/components/ui/primitives";
import { getLens, type LensId } from "@/lib/lens";

export function LensPlaceholder({ lens }: { lens: LensId }) {
  const def = getLens(lens);
  return (
    <PageHero>
      <div className="py-12">
        <Eyebrow>Manage · {def.label}</Eyebrow>
        <h1 className="headline mt-4">{def.label} lens</h1>
        <p className="lede mt-3 max-w-2xl">{def.description}</p>
        <div
          className="mt-10 max-w-2xl rounded-md border border-dashed border-border bg-bg-elevate/40 p-6 text-sm text-text-mute"
          data-testid={`lens-placeholder-${lens}`}
        >
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
            Coming soon
          </div>
          <p className="mt-2">
            The {def.label} lens shell is in place. Its sections, lifecycle
            ribbon and contextual workspace will land in the dependent task
            for this lens.
          </p>
        </div>
      </div>
    </PageHero>
  );
}

export const ClientsLensHome = () => <LensPlaceholder lens="clients" />;
export const PeopleLensHome = () => <LensPlaceholder lens="people" />;
export const PartnersLensHome = () => <LensPlaceholder lens="partners" />;
export const AgentsLensHome = () => <LensPlaceholder lens="agents" />;
export const FinanceLensHome = () => <LensPlaceholder lens="finance" />;
