---
name: Launch site — deck graphics policy
description: How the Cognirise `launch` marketing artifact must treat investor-deck graphics and audience framing.
---

Rule: In the `artifacts/launch` marketing home page, do NOT paste investor-presentation infographics
(img26/27/29/30/31/33) as static images and then add a text section that repeats them. Recreate each
conceptual graphic as a native, interactive, itemized React component (selector/tabs → animated detail
panel), and drop the deck's decorative cruft (dotted leader lines, etc.).

**Why:** The user rejected the pasted-image + redundant-text approach as a "cheap knock-off" and explicitly
asked for each graphic to be made interactive. The site targets CLIENTS, not investors — so investor framing
(VC/market-size stats, "the world's most sophisticated capital is converging on this model") was removed.

**How to apply:** Only photographic/illustrative deck assets are kept as images (img19 hero skyline, img34
founder portrait, img35-37 agent illustrations). Everything conceptual is a coded component. Keep stats
client-value oriented (prototype speed, ownership, agent/guild counts, service lines), not market/investor.

**Fidelity bar (FINAL — rejected 4x before this):** every ATTEMPT TO REPRODUCE the conceptual graphics
failed — hand-coded SVG/CSS read as "cheap imitations", AND AI-GENERATED rendered images in the deck
style were also rejected ("a joke, especially the guilds"). The deck graphics are fully-rendered
atmospheric artwork (volumetric glow, particle fields, depth) that nothing else matches. The approach
the user finally demanded and accepted: **use the ACTUAL deck images, lightly cropped** — `magick
img30.webp -crop WxH+X+Y` to the service-lines node band (drop the slide title + empty dotted-leader
cruft) → `service-lines-deck.webp`; crop img33 to drop only the slide title header, keep the whole
self-contained guild diagram → `guild-deck.webp`. So: do NOT reproduce deck infographics at all (not
SVG, not generated). Crop the originals.

Interactivity layering after cropping: service-lines KEEPS transparent HOTSPOTS pinned to measured
node-center % (SERVICE_NODES in Home.tsx; for the cropped band x≈[12,30.3,48.8,67.2,87.7] y≈54, width
~15% aspect-1, subtle inner-glow ring on active) → detail panel with deliverables (deliverables are NEW
info the deck node doesn't show, so not redundant). Guild graphic is STATIC (no hotspots/panel) because
the deck diagram already labels every guild + agent as text — adding a panel would just repeat it; on
mobile wrap it in `overflow-x-auto` with `min-w-[880px]` so the dense text stays legible. Match panel
service titles to the deck's own node labels (deck says "Engineering with AI", "Sovereign Agentic AI",
"Platforms") to avoid visible mismatch.

Verify mid-page graphics via a temp `/verify` route (hero is min-h-[100dvh] so hash anchors won't scroll
in screenshots; temporarily `export` ServiceLines/GuildSystem from Home.tsx, render them in a throwaway
Verify.tsx, screenshot at viewport ~1280x1500, then revert all scaffolding).

## "From selling effort to outcomes" / TransformationMap section
The `#model` section's diagram is now the USER-UPLOADED rendered artwork, not hand-coded. The
graphic ships as 4 transparent positional layers → `public/images/model/{traditional,logo,center,
outcomes}.png` (left = Traditional Vendor muted icons, center = logo + "Human·Agent·Shared
Intelligence", right = glowing outcomes). Stacking all four in an aspect-[952/481] box rebuilds the
full comparison; revealing them in sequence animates "old model → new model → outcomes".
**Same fidelity rule as the deck graphics:** desktop (md+) uses the real image layers; MOBILE keeps
the existing hand-coded stacked cards because the baked-in text is illegible at phone width. Source
uploads live in `attached_assets/launch_graphics/` (also has heavy 6MB Illustrator SVGs — skip them,
the small PNGs are crisp and fast).
