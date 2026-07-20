import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";

import { useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";

export const WEB_TOP_INSET = 67;
export const WEB_TAB_BAR = 84;

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
  const bg =
    variant === "primary"
      ? c.primary
      : variant === "destructive"
        ? c.destructive
        : variant === "secondary"
          ? c.secondary
          : "transparent";
  const fg =
    variant === "primary"
      ? c.primaryForeground
      : variant === "destructive"
        ? c.destructiveForeground
        : variant === "secondary"
          ? c.secondaryForeground
          : c.primary;
  return (
    <Pressable
      onPress={() => {
        if (isDisabled) return;
        hapticLight();
        onPress();
      }}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: c.radius + 4,
          paddingVertical: 14,
          paddingHorizontal: 18,
          flexDirection: rtl.row,
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Feather name={icon} size={18} color={fg} /> : null}
          <Text style={{ color: fg, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
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
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderRadius: c.radius + 4,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          padding: 16,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Field({
  label,
  style,
  ...props
}: TextInputProps & { label?: string; style?: TextStyle }) {
  const c = useColors();
  const rtl = useRTL();
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "Inter_500Medium",
            fontSize: 13,
            textAlign: rtl.textAlign,
          }}
        >
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={c.mutedForeground}
        {...props}
        style={[
          {
            backgroundColor: c.secondary,
            borderRadius: c.radius + 2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            paddingHorizontal: 14,
            paddingVertical: 12,
            color: c.foreground,
            fontFamily: "Inter_400Regular",
            fontSize: 15,
            textAlign: rtl.textAlign,
            writingDirection: rtl.writingDirection,
          },
          style,
        ]}
      />
    </View>
  );
}

export function Chip({
  label,
  color,
  bg,
}: {
  label: string;
  color?: string;
  bg?: string;
}) {
  const c = useColors();
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: bg ?? c.secondary,
      }}
    >
      <Text
        style={{
          color: color ?? c.secondaryForeground,
          fontFamily: "Inter_600SemiBold",
          fontSize: 11,
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
    <View style={{ alignItems: "center", justifyContent: "center", padding: 40, gap: 10 }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: c.secondary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={28} color={c.mutedForeground} />
      </View>
      <Text
        style={{
          color: c.foreground,
          fontFamily: "Inter_600SemiBold",
          fontSize: 16,
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
            textAlign: "center",
          }}
        >
          {body}
        </Text>
      ) : null}
    </View>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  const c = useColors();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", padding: 40, gap: 12 }}>
      <Feather name="alert-triangle" size={28} color={c.destructive} />
      <Text
        style={{
          color: c.foreground,
          fontFamily: "Inter_500Medium",
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

export function Skeleton({ height = 16, width = "100%", style }: { height?: number; width?: number | string; style?: ViewStyle }) {
  const c = useColors();
  return (
    <View
      style={[
        {
          height,
          width: width as ViewStyle["width"],
          backgroundColor: c.secondary,
          borderRadius: 8,
          opacity: 0.6,
        },
        style,
      ]}
    />
  );
}

export function Divider() {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
}

export interface SheetOption {
  label: string;
  icon?: FeatherName;
  onPress: () => void;
  destructive?: boolean;
}

export function Sheet({
  visible,
  title,
  options,
  onClose,
  cancelLabel,
}: {
  visible: boolean;
  title?: string;
  options: SheetOption[];
  onClose: () => void;
  cancelLabel: string;
}) {
  const c = useColors();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: c.card,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 16,
            paddingBottom: Platform.OS === "web" ? 24 : 40,
            gap: 8,
          }}
        >
          {title ? (
            <Text
              style={{
                color: c.mutedForeground,
                fontFamily: "Inter_500Medium",
                fontSize: 13,
                textAlign: "center",
                paddingBottom: 6,
              }}
            >
              {title}
            </Text>
          ) : null}
          {options.map((o, i) => (
            <Pressable
              key={i}
              onPress={() => {
                hapticLight();
                onClose();
                o.onPress();
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 14,
                paddingHorizontal: 8,
                borderRadius: c.radius + 2,
                backgroundColor: pressed ? c.secondary : "transparent",
              })}
            >
              {o.icon ? (
                <Feather
                  name={o.icon}
                  size={20}
                  color={o.destructive ? c.destructive : c.foreground}
                />
              ) : null}
              <Text
                style={{
                  color: o.destructive ? c.destructive : c.foreground,
                  fontFamily: "Inter_500Medium",
                  fontSize: 16,
                }}
              >
                {o.label}
              </Text>
            </Pressable>
          ))}
          <View style={{ height: 4 }} />
          <Button label={cancelLabel} onPress={onClose} variant="secondary" />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function IconButton({
  icon,
  onPress,
  color,
  size = 22,
}: {
  icon: FeatherName;
  onPress: () => void;
  color?: string;
  size?: number;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => {
        hapticLight();
        onPress();
      }}
      hitSlop={10}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}
    >
      <Feather name={icon} size={size} color={color ?? c.foreground} />
    </Pressable>
  );
}
