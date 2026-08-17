# Consuming Cognirise Atelier in Expo apps

> **Expo / React Native support is not yet available in this package.**
>
> This design system is a web-only artifact. It exports CSS variables
> (`./styles.css`) and DOM-based React components (`./components/*`) that
> cannot run in a React Native / Expo environment. Attempting to import them
> from an Expo app will result in unresolved module errors.
>
> The portable token object (`./tokens`) **is** safe to import in any
> JavaScript environment, including Expo, and can be used to drive a native
> theme manually:
>
> ```tsx
> import { tokens } from "@workspace/cognirise-atelier/tokens";
>
> // Convert CSS rem to device-independent pixels (1rem = 16px)
> const radiusPx =
>   Number.parseFloat(tokens.radius) * 16;
>
> // Use color values directly:
> const primaryColor = tokens.color.dark.primary; // "#C45BB8"
> ```

## Typography

Brand fonts: **Comfortaa** for all headings, display text, and the brand
wordmark (weights 400 and 700 only — never a synthesized 600); **Inter** for
body copy, UI labels, buttons, stats, and captions (weights 400, 600, 800).
Unlike web, React Native does not load fonts from CSS — the consuming Expo app
must load them itself via `expo-font` and the `@expo-google-fonts` packages:

```bash
pnpm add @expo-google-fonts/comfortaa @expo-google-fonts/inter expo-font
```

```tsx
import {
  Comfortaa_400Regular,
  Comfortaa_700Bold,
} from "@expo-google-fonts/comfortaa";
import {
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/inter";

const [fontsLoaded, fontError] = useFonts({
  Comfortaa_400Regular,
  Comfortaa_700Bold,
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_800ExtraBold,
});
```

Load these once in the root layout and hold the splash screen until
`fontsLoaded || fontError`. Reference the fonts by their loaded names in
styles (`fontFamily: "Comfortaa_700Bold"` for headings/wordmark,
`fontFamily: "Inter_400Regular"` etc. for body/UI).

Usage rules (mirroring the web guidance):

- Headings, display text, and the wordmark use Comfortaa only, at weight 400
  or 700. Comfortaa ships no other weights here — **never synthesize a 600**
  (React Native will fake-bold if you pair `Comfortaa_400Regular` with
  `fontWeight: "600"`; don't).
- Comfortaa has **no italic**. Do not apply `fontStyle: "italic"` to it;
  italic accents are an Inter-only affordance.
- Body copy, UI labels, buttons, stats, and captions use Inter (400/600/800).
  Do not use Comfortaa for body copy.
- Set `fontWeight` implicitly by choosing the loaded font name (e.g.
  `Inter_600SemiBold`), not via the `fontWeight` style property, to avoid
  faux-bolding on Android.

## App shell & chat

The app-shell and chat conventions (chat area pinned to screen height with an
internally scrolling transcript and bottom-fixed composer; composer anatomy —
36px circular "+" attach button, 22px-radius input pill, 32px circular accent
send button; lens selection via a drop-down in the title bar; and a
light/dark/system theme mode selector in the title bar) are defined in
`docs/consuming-web.md` under **App shell & chat**. Mirror the same anatomy,
proportions, and behaviors natively (e.g. `KeyboardAvoidingView` + a
`FlatList` transcript with the composer outside it, a native menu for the
lens picker, and `Appearance`/`useColorScheme` for the System theme mode).

> For a complete native component layer (Button, Card, Badge, etc.), native
> theme hook, and font hook wired for Expo — see Task #1273 "Add a custom
> Cognirise component library on top of the design-system tokens". That task
> will add `src/components/native/` and the necessary hooks before Expo
> consumption works end-to-end.
