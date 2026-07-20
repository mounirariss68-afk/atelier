import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "atelier_session_token";

let currentToken: string | null = null;

export function getTokenSync(): string | null {
  return currentToken;
}

export async function persistToken(token: string | null): Promise<void> {
  currentToken = token;
  try {
    if (Platform.OS === "web") {
      if (token) await AsyncStorage.setItem(KEY, token);
      else await AsyncStorage.removeItem(KEY);
    } else {
      if (token) await SecureStore.setItemAsync(KEY, token);
      else await SecureStore.deleteItemAsync(KEY);
    }
  } catch {
    // best-effort persistence — the in-memory token still works this session
  }
}

export async function loadToken(): Promise<string | null> {
  try {
    const t =
      Platform.OS === "web"
        ? await AsyncStorage.getItem(KEY)
        : await SecureStore.getItemAsync(KEY);
    currentToken = t;
    return t;
  } catch {
    return null;
  }
}
