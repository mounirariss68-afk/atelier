---
name: Launch hero crossfade blank-frame guard
description: How the launch Home hero carousel avoids blank frames on slow phones
---
The launch `Home.tsx` HeroCarousel crossfades a right-side slide image. To never flash a blank
(navy) frame on slow networks / low-end CPUs, the crossfade is LOAD-GATED, not time-gated:

- `selected` = target slide; `shown` = the slide currently held at full opacity.
- A slide only counts as ready once its image is **decoded** (`img.decode()` via both a ref
  callback for cached images and `onLoad` for fresh fetches; `onError` also marks ready so a
  broken image can't permanently stall autoplay).
- The previous `shown` slide is held at opacity 1 until `loaded.has(selected)` flips true; only
  then does the crossfade run and `shown` get promoted to `selected`.
- Outgoing slides are kept mounted via a `fadingOut` set until their fade-out
  `onAnimationComplete` fires — so the outgoing image is never unmounted mid-crossfade during
  rapid dot-tapping. Mount rule: `i===selected || i===shown || fadingOut.has(i)`.

**Why:** the earlier version mounted only `{selected, prev}` (prev tracked in an effect-updated
ref) and faded purely on a timer, so a not-yet-loaded incoming image + outgoing unmount could
show navy. **How to apply:** keep the load-gate and the fadingOut mount window together — removing
either reintroduces the blank-frame risk. Slide 0 stays `loading="eager"`, others `lazy`.
