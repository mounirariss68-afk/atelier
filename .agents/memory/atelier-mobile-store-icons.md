---
name: Atelier mobile store icon pipeline
description: Store-build icon invariants for the Expo app and how to verify them without polluting the repo
---
# Atelier mobile store icon pipeline

- `icon.png` (iOS) must have NO alpha channel (Apple rejects transparency). It was stripped with `magick icon.png -alpha off png24:icon.png` — if the icon is ever regenerated, strip alpha again.
- `adaptive-icon.png` foreground content must fit the Android adaptive-icon safe circle: radius 313px on a 1024px canvas (66/108 dp). Original art overflowed by ~7px; it now sits at 96% scale. Check with: alpha-extract × inverted circle mask (`circle 512,512 512,199`) → maxima must be 0.
- `monochrome-icon.png` (Android 13+ themed icons) is the alpha silhouette colorized white; wired via `android.adaptiveIcon.monochromeImage` (supported SDK 50+).
- **How to verify:** copy the artifact to /tmp, symlink `node_modules`, run `npx expo prebuild --no-install --platform android|ios`, then inspect `res/mipmap-anydpi-v26/ic_launcher.xml` (should list background/foreground/monochrome) and the iOS `AppIcon` PNG (`identify` must show no alpha). Delete the temp copy — never prebuild in the repo.
- Splash: prebuild generates light (`#F5F6FA`) and dark (`#0A1230`) resources from `splash.dark`; on-device visual check still pending a real EAS build.
