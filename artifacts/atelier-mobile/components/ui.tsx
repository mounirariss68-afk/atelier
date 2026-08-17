import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  ScrollView,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";

import { useRTL } from "@/contexts/I18nContext";
import { useThemeScheme } from "@/contexts/ThemeContext";
import { useColors } from "@/hooks/useColors";

export const WEB_TOP_INSET = 67;
export const WEB_TAB_BAR = 96;

/** Brand-standard easing (cubic-bezier(0.22, 1, 0.36, 1) from the web). */
export const BRAND_EASING = Easing.bezier(0.22, 1, 0.36, 1);

export function hapticLight() {
  if (Platform.OS !== "web")
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
export function hapticSuccess() {
  if (Platform.OS !== "web")
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
}
export function hapticError() {
  if (Platform.OS !== "web")
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
      () => {},
    );
}

type FeatherName = React.ComponentProps<typeof Feather>["name"];

/** Soft, large drop shadow matching the web's depth language. */
export function softShadow(color: string): ViewStyle {
  return Platform.OS === "web"
    ? ({ boxShadow: `0 18px 36px -18px ${color}` } as unknown as ViewStyle)
    : {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.28,
        shadowRadius: 24,
        elevation: 8,
      };
}

/**
 * Press-scale wrapper: standard micro-interaction for tappable surfaces.
 */
export function PressScale({
  onPress,
  disabled,
  children,
  style,
  scaleTo = 0.97,
  haptic = true,
}: {
  onPress?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  scaleTo?: number;
  haptic?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (to: number) =>
    Animated.timing(scale, {
      toValue: to,
      duration: 180,
      easing: BRAND_EASING,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  return (
    <Pressable
      onPress={() => {
        if (disabled || !onPress) return;
        if (haptic) hapticLight();
        onPress();
      }}
      disabled={disabled}
      onPressIn={() => animate(scaleTo)}
      onPressOut={() => animate(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/**
 * Staggered entrance: fades and slides content in with the brand easing.
 */
export function FadeInView({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: ViewStyle;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(14)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 420,
        delay,
        easing: BRAND_EASING,
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.timing(translate, {
        toValue: 0,
        duration: 420,
        delay,
        easing: BRAND_EASING,
        useNativeDriver: Platform.OS !== "web",
      }),
    ]).start();
  }, [opacity, translate, delay]);
  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY: translate }] }]}>
      {children}
    </Animated.View>
  );
}

/**
 * Task #999 — honour iOS "Reduce Transparency": glass surfaces degrade to
 * their near-opaque fallback when the user asks the system to cut blur.
 */
let reduceTransparencyCache: boolean | null = null;
function useReduceTransparency(): boolean {
  // Until the system setting resolves, err on the opaque side (treat as
  // reduced) so accessibility users never see a transparency flash. The
  // resolved value is cached module-wide, so the conservative first frame
  // only happens on the very first glass surface after app launch.
  const [reduced, setReduced] = useState<boolean | null>(
    Platform.OS === "ios" ? reduceTransparencyCache : false,
  );
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let alive = true;
    const apply = (v: boolean) => {
      reduceTransparencyCache = v;
      if (alive) setReduced(v);
    };
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then(apply)
      .catch(() => alive && setReduced(false));
    const sub = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      apply,
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced ?? true;
}

// Feature-detected once: true only on iOS 26+ builds that ship the native
// Liquid Glass module (false in Expo Go / web / older iOS — those keep the
// BlurView path below). isLiquidGlassAvailable() requires the native module
// and THROWS when the binary doesn't ship it (Expo Go, older installed
// builds receiving this JS via update) — fail closed to the BlurView path.
const liquidGlass = (() => {
  if (Platform.OS !== "ios") return false;
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

/**
 * Glass surface: native blur with a solid translucent fallback (web /
 * platforms without blur). For floating/overlay layers only.
 * Task #999: on iOS 26+ this renders Apple's Liquid Glass material.
 */
export function Glass({
  children,
  style,
  intensity = 40,
  radius,
}: {
  children?: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  intensity?: number;
  radius?: number;
}) {
  const c = useColors();
  const scheme = c.background === "#0A1230" ? "dark" : "light";
  const reduceTransparency = useReduceTransparency();
  const borderRadius = radius ?? 24;
  const frame: ViewStyle = {
    borderRadius,
    borderWidth: 1,
    borderColor: c.glassBorder,
    overflow: "hidden",
  };
  if (Platform.OS === "web") {
    return (
      <View
        style={[
          frame,
          {
            backgroundColor: c.glass,
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
          } as unknown as ViewStyle,
          style,
        ]}
      >
        {children}
      </View>
    );
  }
  if (Platform.OS === "android" || reduceTransparency) {
    // Blur is unreliable on Android; iOS "Reduce Transparency" users asked
    // for it — solid translucent fallback in both cases.
    return (
      <View style={[frame, { backgroundColor: scheme === "dark" ? "rgba(13,20,52,0.94)" : "rgba(255,255,255,0.94)" }, style]}>
        {children}
      </View>
    );
  }
  if (liquidGlass) {
    // Task #999 — Apple's Liquid Glass material on iOS 26+. A light theme
    // tint keeps parity with the BlurView branch's glass wash.
    return (
      <GlassView
        glassEffectStyle="regular"
        tintColor={scheme === "dark" ? "rgba(13,20,52,0.30)" : "rgba(255,255,255,0.25)"}
        style={[frame, style]}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView intensity={intensity + 40} tint={scheme === "dark" ? "dark" : "light"} style={[frame, { backgroundColor: c.glass }, style]}>
      {children}
    </BlurView>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  loading?: boolean;
  disabled?: boolean;
  icon?: FeatherName;
  style?: ViewStyle;
}) {
  const c = useColors();
  const rtl = useRTL();
  const isDisabled = disabled || loading;
  const fg =
    variant === "primary"
      ? "#FFFFFF"
      : variant === "destructive"
        ? c.destructiveForeground
        : variant === "secondary"
          ? c.secondaryForeground
          : c.primary;

  const inner = (
    <View
      style={{
        paddingVertical: 12,
        paddingHorizontal: 16,
        flexDirection: rtl.row,
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 44,
      }}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Feather name={icon} size={17} color={fg} /> : null}
          <Text
            style={{
              color: fg,
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
              letterSpacing: 0.2,
            }}
          >
            {label}
          </Text>
        </>
      )}
    </View>
  );

  return (
    <PressScale
      onPress={onPress}
      disabled={isDisabled}
      style={[{ opacity: isDisabled ? 0.55 : 1 }, style ?? {}]}
    >
      {variant === "primary" ? (
        <View
          style={[
            { backgroundColor: c.primary, borderRadius: 16, overflow: "hidden" },
            softShadow(c.tint45),
          ]}
        >
          {inner}
        </View>
      ) : (
        <View
          style={{
            backgroundColor:
              variant === "destructive"
                ? c.destructive
                : variant === "secondary"
                  ? c.secondary
                  : "transparent",
            borderRadius: 16,
            borderWidth: variant === "secondary" ? 1 : 0,
            borderColor: c.borderSoft,
          }}
        >
          {inner}
        </View>
      )}
    </PressScale>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const c = useColors();
  const reduceTransparency = useReduceTransparency();
  // Task #999 — content cards read as translucent glass over the backdrop
  // artwork (web parity). A per-card native blur would be too costly in
  // long scroll lists, so cards use a tuned translucent wash instead (web
  // adds a real backdrop blur, which is cheap there). Android and
  // Reduce-Transparency users keep the opaque card exactly as before.
  const glassCard = Platform.OS !== "android" && !reduceTransparency;
  return (
    <View
      style={[
        {
          backgroundColor: glassCard ? c.cardGlass : c.card,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: c.borderSoft,
          padding: 16,
        },
        glassCard && Platform.OS === "web"
          ? ({
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
            } as unknown as ViewStyle)
          : null,
        softShadow(c.shadow),
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * Floating-label text field: label rests as placeholder, floats up on
 * focus or when filled; magenta focus ring.
 */
export function Field({
  label,
  style,
  error,
  onFocus,
  onBlur,
  value,
  ...props
}: TextInputProps & { label?: string; style?: TextStyle; error?: string | null }) {
  const c = useColors();
  const scheme = useThemeScheme();
  const rtl = useRTL();
  const [focused, setFocused] = useState(false);
  const lifted = focused || !!(value && String(value).length > 0);
  const anim = useRef(new Animated.Value(lifted ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: lifted ? 1 : 0,
      duration: 200,
      easing: BRAND_EASING,
      useNativeDriver: false,
    }).start();
  }, [lifted, anim]);

  const multiline = props.multiline;
  return (
    <View style={{ gap: 4 }}>
      <View
        style={{
          backgroundColor: c.secondary,
          borderRadius: 14,
          borderWidth: 1.5,
          borderColor: error ? c.destructive : focused ? c.primary : c.borderSoft,
          paddingHorizontal: 14,
          paddingTop: label ? 18 : 11,
          paddingBottom: 8,
          minHeight: label ? 48 : 42,
        }}
      >
        {label ? (
          <Animated.Text
            numberOfLines={1}
            style={{
              position: "absolute",
              [rtl.isRTL ? "right" : "left"]: 14,
              top: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 6] }),
              fontSize: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 11] }),
              color: focused ? c.primary : c.mutedForeground,
              fontFamily: "Inter_600SemiBold",
              letterSpacing: 0.2,
            }}
          >
            {label}
          </Animated.Text>
        ) : null}
        <TextInput
          placeholderTextColor={c.faint}
          keyboardAppearance={scheme}
          {...props}
          value={value}
          placeholder={lifted ? props.placeholder : undefined}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            {
              color: c.foreground,
              fontFamily: "Inter_400Regular",
              fontSize: 14,
              padding: 0,
              textAlign: rtl.textAlign,
              writingDirection: rtl.writingDirection,
              ...(multiline ? { minHeight: 60, textAlignVertical: "top" as const } : {}),
            },
            style,
          ]}
        />
      </View>
      {error ? (
        <Text
          style={{
            color: c.destructive,
            fontFamily: "Inter_400Regular",
            fontSize: 12.5,
            textAlign: rtl.textAlign,
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  color,
  bg,
  icon,
}: {
  label: string;
  color?: string;
  bg?: string;
  icon?: FeatherName;
}) {
  const c = useColors();
  const rtl = useRTL();
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: bg ?? c.elevate2,
        borderWidth: 1,
        borderColor: c.borderSoft,
        flexDirection: rtl.row,
        alignItems: "center",
        gap: 5,
      }}
    >
      {icon ? <Feather name={icon} size={11} color={color ?? c.secondaryForeground} /> : null}
      <Text
        style={{
          color: color ?? c.secondaryForeground,
          fontFamily: "Inter_600SemiBold",
          fontSize: 11,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon: FeatherName;
  title: string;
  body?: string;
}) {
  const c = useColors();
  return (
    <FadeInView style={{ alignItems: "center", justifyContent: "center", padding: 40, gap: 12 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: c.tint08,
          borderWidth: 1,
          borderColor: c.tint25,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={30} color={c.primary} />
      </View>
      <Text
        style={{
          color: c.foreground,
          fontFamily: "Inter_600SemiBold",
          fontSize: 17,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      {body ? (
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "Inter_400Regular",
            fontSize: 14,
            lineHeight: 21,
            textAlign: "center",
          }}
        >
          {body}
        </Text>
      ) : null}
    </FadeInView>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  const c = useColors();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", padding: 40, gap: 14 }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: c.destructiveTint,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name="alert-triangle" size={26} color={c.destructive} />
      </View>
      <Text
        style={{
          color: c.foreground,
          fontFamily: "Inter_600SemiBold",
          fontSize: 15,
          textAlign: "center",
        }}
      >
        {message ?? "Something went wrong"}
      </Text>
      {onRetry ? <Button label="Retry" onPress={onRetry} variant="secondary" icon="refresh-cw" /> : null}
    </View>
  );
}

/** Shimmer skeleton: animated highlight sweep with the brand easing. */
export function Skeleton({
  height = 16,
  width = "100%",
  style,
}: {
  height?: number;
  width?: number | string;
  style?: ViewStyle;
}) {
  const c = useColors();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return (
    <View
      style={[
        {
          height,
          width: width as ViewStyle["width"],
          backgroundColor: c.elevate2,
          borderRadius: 10,
          overflow: "hidden",
        },
        style,
      ]}
    >
      <Animated.View
        style={{
          ...StyleSheet.absoluteFillObject,
          transform: [
            {
              translateX: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [-260, 260],
              }),
            },
          ],
        }}
      >
        <LinearGradient
          colors={["transparent", c.tint08, "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1, width: 260 }}
        />
      </Animated.View>
    </View>
  );
}

export function Divider() {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.borderSoft }} />;
}

export interface SheetOption {
  label: string;
  icon?: FeatherName;
  onPress: () => void;
  destructive?: boolean;
  /**
   * Task #477 — defer the action until the sheet's Modal has FULLY dismissed.
   * Launching a native picker (document/camera/library) while the modal is
   * still animating away silently fails on iOS and can leave the native
   * module stuck "in progress". iOS runs the action from Modal onDismiss
   * (fires post-dismissal); Android falls back to a short delay; web runs
   * immediately.
   */
  defer?: boolean;
}

/** Bottom sheet: glass panel over a dimmed scrim, grab handle, soft radius. */
export function Sheet({
  visible,
  title,
  options,
  onClose,
  cancelLabel,
  onOptionSelected,
}: {
  visible: boolean;
  title?: string;
  options: SheetOption[];
  onClose: () => void;
  cancelLabel: string;
  /**
   * Task #797 — fires synchronously when an option is tapped, BEFORE the
   * sheet closes and before any deferred action runs. Lets callers that
   * chain into native pickers keep a sibling Modal hidden across the whole
   * dismiss → pick window (cancel/scrim taps do NOT fire this).
   */
  onOptionSelected?: () => void;
}) {
  const c = useColors();
  const rtl = useRTL();
  const pendingRef = useRef<(() => void) | null>(null);
  const runPending = () => {
    const fn = pendingRef.current;
    pendingRef.current = null;
    if (fn) fn();
  };
  // Drop any stale deferred action if the sheet unmounts before it ran.
  useEffect(() => () => {
    pendingRef.current = null;
  }, []);
  const handleOption = (o: SheetOption) => {
    hapticLight();
    onOptionSelected?.();
    if (o.defer && Platform.OS !== "web") {
      pendingRef.current = o.onPress;
      onClose();
      if (Platform.OS !== "ios") {
        // Android Modal has no onDismiss; small delay is enough there.
        setTimeout(runPending, 300);
      }
      return;
    }
    onClose();
    o.onPress();
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={Platform.OS === "ios" ? runPending : undefined}
    >
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end", padding: 10 }}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <Glass
            radius={28}
            style={[{ padding: 16, paddingBottom: Platform.OS === "web" ? 20 : 32, gap: 6 }, softShadow(c.shadow)]}
          >
            <View
              style={{
                alignSelf: "center",
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: c.faint,
                opacity: 0.5,
                marginBottom: 8,
              }}
            />
            {title ? (
              <Text
                style={{
                  color: c.mutedForeground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 13,
                  letterSpacing: 0.4,
                  textAlign: "center",
                  paddingBottom: 8,
                }}
              >
                {title}
              </Text>
            ) : null}
            {options.map((o, i) => (
              <Pressable
                key={i}
                onPress={() => handleOption(o)}
                style={({ pressed }) => ({
                  flexDirection: rtl.row,
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 14,
                  paddingHorizontal: 12,
                  borderRadius: 14,
                  backgroundColor: pressed ? c.tint08 : "transparent",
                })}
              >
                {o.icon ? (
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 12,
                      backgroundColor: o.destructive ? c.destructiveTint : c.tint08,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Feather
                      name={o.icon}
                      size={17}
                      color={o.destructive ? c.destructive : c.primary}
                    />
                  </View>
                ) : null}
                <Text
                  style={{
                    color: o.destructive ? c.destructive : c.foreground,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 15.5,
                  }}
                >
                  {o.label}
                </Text>
              </Pressable>
            ))}
            <View style={{ height: 6 }} />
            <Button label={cancelLabel} onPress={onClose} variant="secondary" />
          </Glass>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function IconButton({
  icon,
  onPress,
  color,
  size = 20,
  filled = false,
}: {
  icon: FeatherName;
  onPress: () => void;
  color?: string;
  size?: number;
  filled?: boolean;
}) {
  const c = useColors();
  return (
    <PressScale onPress={onPress} scaleTo={0.9}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: filled ? c.tint08 : "transparent",
          borderWidth: filled ? 1 : 0,
          borderColor: c.tint25,
        }}
      >
        <Feather name={icon} size={size} color={color ?? c.foreground} />
      </View>
    </PressScale>
  );
}

/**
 * Searchable picker sheet for long entity lists (accounts, engagements).
 * A filter field appears once the list is long enough to need one.
 */
export function PickerSheet({
  visible,
  title,
  items,
  selectedId,
  onSelect,
  onClose,
  cancelLabel,
  searchPlaceholder,
  emptyLabel,
}: {
  visible: boolean;
  title?: string;
  items: { id: string; name: string }[];
  selectedId?: string | null;
  onSelect: (item: { id: string; name: string }) => void;
  onClose: () => void;
  cancelLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
}) {
  const c = useColors();
  const rtl = useRTL();
  const scheme = useThemeScheme();
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);
  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((x) => x.name.toLowerCase().includes(q)) : items;
  const searchable = items.length > 6;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end", padding: 10 }}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <Glass
            radius={28}
            style={[{ padding: 16, paddingBottom: Platform.OS === "web" ? 20 : 32, gap: 6 }, softShadow(c.shadow)]}
          >
            <View
              style={{
                alignSelf: "center",
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: c.faint,
                opacity: 0.5,
                marginBottom: 8,
              }}
            />
            {title ? (
              <Text
                style={{
                  color: c.mutedForeground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 13,
                  letterSpacing: 0.4,
                  textAlign: "center",
                  paddingBottom: 8,
                }}
              >
                {title}
              </Text>
            ) : null}
            {searchable ? (
              <View
                style={{
                  flexDirection: rtl.row,
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: c.secondary,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: c.borderSoft,
                  paddingHorizontal: 12,
                  marginBottom: 6,
                }}
              >
                <Feather name="search" size={15} color={c.mutedForeground} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={searchPlaceholder}
                  placeholderTextColor={c.faint}
                  keyboardAppearance={scheme}
                  autoCorrect={false}
                  style={{
                    flex: 1,
                    color: c.foreground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 15,
                    paddingVertical: 10,
                    textAlign: rtl.textAlign,
                  }}
                />
                {query.length > 0 ? (
                  <Pressable onPress={() => setQuery("")} hitSlop={8}>
                    <Feather name="x" size={15} color={c.mutedForeground} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <ScrollView
              style={{ maxHeight: 340 }}
              keyboardShouldPersistTaps="handled"
            >
              {filtered.length === 0 ? (
                <Text
                  style={{
                    color: c.mutedForeground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 14,
                    textAlign: "center",
                    paddingVertical: 20,
                  }}
                >
                  {emptyLabel}
                </Text>
              ) : (
                filtered.map((item) => {
                  const selected = item.id === selectedId;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => {
                        hapticLight();
                        onClose();
                        onSelect(item);
                      }}
                      style={({ pressed }) => ({
                        flexDirection: rtl.row,
                        alignItems: "center",
                        gap: 12,
                        paddingVertical: 14,
                        paddingHorizontal: 12,
                        borderRadius: 14,
                        backgroundColor: pressed ? c.tint08 : selected ? c.tint08 : "transparent",
                      })}
                    >
                      <Text
                        numberOfLines={1}
                        style={{
                          flex: 1,
                          color: selected ? c.primary : c.foreground,
                          fontFamily: selected
                            ? "Inter_600SemiBold"
                            : "Inter_600SemiBold",
                          fontSize: 15.5,
                          textAlign: rtl.textAlign,
                        }}
                      >
                        {item.name}
                      </Text>
                      {selected ? <Feather name="check" size={17} color={c.primary} /> : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <View style={{ height: 6 }} />
            <Button label={cancelLabel} onPress={onClose} variant="secondary" />
          </Glass>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
