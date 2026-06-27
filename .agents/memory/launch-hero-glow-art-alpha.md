---
name: Launch hero glow-on-black art blending
description: How to make glow-on-near-black hero/slide artwork sit seamlessly on the navy launch page (no visible card/box).
---

The launch site hero slide PNGs are glowing diagrams on a near-uniform near-black background (corner pixels ~srgb(1,2,20)). Shown on the navy hero they read as a dark rectangular card unless the background is dropped out.

**What does NOT work:** CSS `mix-blend-screen` on the image. The hero uses an Embla carousel (`@/components/ui/carousel`), whose track/viewport containers set `transform` + `overflow`, creating a new stacking/isolation context. A blend mode there has no page backdrop to composite against, so it produces no visible effect (or you have to add a flat `bg-navy` behind it, which then mismatches the page's radial gradient + floating glows and leaves a faint box).

**What works:** bake transparency into the PNGs with a luminance→alpha pass, then render the image plainly (object-contain, no bg, no blend). The transparent areas let the real page gradient/glows show through — truly seamless.
ImageMagick: `convert in.png \( +clone -colorspace Gray -auto-level -level 0%,55% \) -alpha off -compose CopyOpacity -composite out.png`. Tune the `-level` upper bound to trade graphic brightness vs. background suppression. Keep originals; write `_t.png` siblings in `attached_assets/` and point the `@assets` imports at them.

**Why:** brightness IS the content for glow-on-black art, so luminance-as-alpha mimics a screen blend but is backdrop-independent (works regardless of carousel isolation) and preserves smooth glow edges. AI background removal is unreliable on dark-card art (see logo-bg-removal note).
