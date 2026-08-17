import { Feather } from "@expo/vector-icons";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Animated, Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BRAND_EASING,
  Button,
  Card,
  hapticError,
  hapticSuccess,
  softShadow,
} from "@/components/ui";
import { useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";

type ToastKind = "success" | "error" | "info";

interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
}

interface FeedbackCtx {
  toast: (message: string, kind?: ToastKind) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
}

const Ctx = createContext<FeedbackCtx>({
  toast: () => {},
  confirm: async () => false,
});

export function useFeedback(): FeedbackCtx {
  return useContext(Ctx);
}

const TOAST_ICON: Record<ToastKind, React.ComponentProps<typeof Feather>["name"]> = {
  success: "check-circle",
  error: "alert-circle",
  info: "info",
};

/**
 * Branded feedback layer: themed toast banner + promise-based confirm
 * dialog. Replaces the OS-default Alert.alert so feedback matches the
 * Cognirise design language in both themes.
 */
export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const rtl = useRTL();
  const insets = useSafeAreaInsets();

  const [toastState, setToastState] = useState<{
    message: string;
    kind: ToastKind;
    id: number;
  } | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [confirmState, setConfirmState] = useState<
    (ConfirmOpts & { resolve: (v: boolean) => void }) | null
  >(null);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      if (kind === "success") hapticSuccess();
      else if (kind === "error") hapticError();
      setToastState({ message, kind, id: Date.now() });
    },
    [],
  );

  useEffect(() => {
    if (!toastState) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    toastAnim.setValue(0);
    Animated.timing(toastAnim, {
      toValue: 1,
      duration: 320,
      easing: BRAND_EASING,
      useNativeDriver: Platform.OS !== "web",
    }).start();
    hideTimer.current = setTimeout(() => {
      Animated.timing(toastAnim, {
        toValue: 0,
        duration: 260,
        easing: BRAND_EASING,
        useNativeDriver: Platform.OS !== "web",
      }).start(({ finished }) => {
        if (finished) setToastState(null);
      });
    }, 2600);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [toastState, toastAnim]);

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ ...opts, resolve });
      }),
    [],
  );

  const settle = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirmState(null);
  };

  const toastColor =
    toastState?.kind === "success"
      ? c.success
      : toastState?.kind === "error"
        ? c.destructive
        : c.primary;

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}

      {toastState ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: (Platform.OS === "web" ? 16 : insets.top + 8),
            left: 16,
            right: 16,
            opacity: toastAnim,
            transform: [
              {
                translateY: toastAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-16, 0],
                }),
              },
            ],
            zIndex: 1000,
          }}
        >
          <View
            style={[
              {
                flexDirection: rtl.row,
                alignItems: "center",
                gap: 10,
                backgroundColor: c.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: c.borderSoft,
                paddingHorizontal: 14,
                paddingVertical: 12,
              },
              softShadow(c.shadow),
            ]}
          >
            <Feather name={TOAST_ICON[toastState.kind]} size={18} color={toastColor} />
            <Text
              style={{
                color: c.foreground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 14,
                flex: 1,
                textAlign: rtl.textAlign,
              }}
              numberOfLines={2}
            >
              {toastState.message}
            </Text>
          </View>
        </Animated.View>
      ) : null}

      <Modal
        visible={!!confirmState}
        transparent
        animationType="fade"
        onRequestClose={() => settle(false)}
      >
        <Pressable
          onPress={() => settle(false)}
          style={{
            flex: 1,
            backgroundColor: c.scrim,
            justifyContent: "center",
            padding: 28,
          }}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <Card style={{ gap: 12, padding: 20 }}>
              <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 10 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    backgroundColor: confirmState?.destructive
                      ? c.destructiveTint
                      : c.tint08,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Feather
                    name={confirmState?.destructive ? "trash-2" : "help-circle"}
                    size={17}
                    color={confirmState?.destructive ? c.destructive : c.primary}
                  />
                </View>
                <Text
                  style={{
                    color: c.foreground,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 17,
                    flex: 1,
                    textAlign: rtl.textAlign,
                  }}
                >
                  {confirmState?.title}
                </Text>
              </View>
              {confirmState?.message ? (
                <Text
                  style={{
                    color: c.mutedForeground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 14,
                    lineHeight: 21,
                    textAlign: rtl.textAlign,
                  }}
                >
                  {confirmState.message}
                </Text>
              ) : null}
              <View style={{ flexDirection: rtl.row, gap: 10, marginTop: 4 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={confirmState?.cancelLabel ?? ""}
                    variant="secondary"
                    onPress={() => settle(false)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label={confirmState?.confirmLabel ?? ""}
                    variant={confirmState?.destructive ? "destructive" : "primary"}
                    onPress={() => settle(true)}
                  />
                </View>
              </View>
            </Card>
          </Pressable>
        </Pressable>
      </Modal>
    </Ctx.Provider>
  );
}
