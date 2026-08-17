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
>
> For a complete native component layer (Button, Card, Badge, etc.), native
> theme hook, and font hook wired for Expo — see Task #1273 "Add a custom
> Cognirise component library on top of the design-system tokens". That task
> will add `src/components/native/` and the necessary hooks before Expo
> consumption works end-to-end.
