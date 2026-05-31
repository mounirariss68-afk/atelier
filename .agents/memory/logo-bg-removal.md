---
name: Logo-on-navy background removal
description: How to cut a transparent logo out of artwork delivered as a logo on a dark navy card
---

When brand logo artwork arrives as a lockup baked onto a dark navy card (e.g. Cognirise's "cognirise" lockup on #0A1230 with a faint grid):

**Rule:** Do NOT rely on the AI `remove_image_background_tool` — it treats the entire navy card as the subject and returns the image essentially unchanged. Instead color-key the near-uniform navy to transparent with ImageMagick.

**Why:** The glyph dots, white wordmark, and gradient tagline all sit ON the navy, so the matting model sees one solid object. Color-keying works because the background navy is nearly uniform and far darker than every foreground element.

**How to apply:**
- Sample corner/background pixels first (`magick in.png -format "%[pixel:p{x,y}]" info:`). Cognirise bg ≈ srgb(7–15,17–25,44–52) ≈ brand navy #0A1230; grid lines slightly lighter.
- Key it out: `magick in.png -fuzz ~16% -transparent "#0A1230" -trim +repage out.png` (a second pass on the lighter grid color may help).
- The white wordmark is invisible on light backgrounds — that's expected. Keep a separate cropped glyph-only "mark" (transparent) for light surfaces and square favicons.
- Verify by flattening onto both navy and white (`-background <col> -flatten`) and eyeballing.
- Generate favicons/app-icons/OG from the glyph master with `magick -resize` and `-define icon:auto-resize=...`; build OG cards as navy canvas + composited lockup.
