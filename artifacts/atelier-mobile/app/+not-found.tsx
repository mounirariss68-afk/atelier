import { Feather } from "@expo/vector-icons";
import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";

import { BrandGradient, FadeInView } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export default function NotFoundScreen() {
  const c = useColors();

  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          backgroundColor: c.background,
          gap: 18,
        }}
      >
        <FadeInView style={{ alignItems: "center", gap: 18 }}>
          <View
            style={{
              width: 76,
              height: 76,
              borderRadius: 26,
              backgroundColor: c.tint08,
              borderWidth: 1,
              borderColor: c.tint25,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="compass" size={32} color={c.primary} />
          </View>
          <Text
            style={{
              color: c.foreground,
              fontFamily: "PlusJakartaSans_800ExtraBold",
              fontSize: 21,
              letterSpacing: -0.3,
              textAlign: "center",
            }}
          >
            This screen doesn&apos;t exist.
          </Text>
          <Link href="/" asChild>
            <BrandGradient
              style={{
                borderRadius: 16,
                paddingHorizontal: 22,
                paddingVertical: 14,
              }}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
            >
              <Text
                style={{
                  color: "#FFFFFF",
                  fontFamily: "PlusJakartaSans_700Bold",
                  fontSize: 15,
                }}
              >
                Go to home screen
              </Text>
            </BrandGradient>
          </Link>
        </FadeInView>
      </View>
    </>
  );
}
