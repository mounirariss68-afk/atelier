import { Feather } from "@expo/vector-icons";
import {
  getAtelierDownloadMyDocumentUrl,
  useAtelierCreateMyDocument,
  useAtelierGetMyProfile,
  useAtelierListMyDocuments,
  useAtelierListMyTasks,
  useAtelierCreateMyTask,
  useAtelierUpdateMyTask,
  useAtelierDeleteMyTask,
  useAtelierReplaceMyDocumentScan,
  useAtelierUploadMyPhoto,
} from "@workspace/api-client-react";
import type { AtelierSelfDocument } from "@workspace/api-client-react";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";

import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  FadeInView,
  PressScale,
  Sheet,
  Skeleton,
  WEB_TAB_BAR,
  hapticError,
  hapticSuccess,
  softShadow,
} from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { AppBackground } from "@/components/AppBackground";
import { AppHeader } from "@/components/AppHeader";
import { useColors } from "@/hooks/useColors";
import { API_BASE, authHeader } from "@/lib/api";
import { openDocumentFile } from "@/lib/documentOpen";
import { getFileSystem, getSharing } from "@/lib/nativeModules";
import { runExclusivePick } from "@/lib/pickerGuard";
import {
  disableTaskPush,
  enableTaskPush,
  getPushEnabledSync,
  loadPushEnabled,
  pushSupported,
  subscribePushEnabled,
} from "@/lib/pushNotifications";
import { TextInput } from "react-native";

// ============================================================
// Task #430 — self-billed (RCTI) invoices for contractors and
// partner-firm resources. Bespoke /me/self-billing routes are not in
// the openapi spec, so this section uses raw fetch.
// ============================================================
interface MySelfBilledInvoice {
  id: string;
  invoiceNumber: string;
  weekIso: string;
  currency: string;
  totalAmount: number;
  status: "draft" | "approved" | "disputed" | "scheduled" | "paid";
  disputeReason: string | null;
  paidAt: string | null;
  remittanceRef: string | null;
}

function useMySelfBilling() {
  const [items, setItems] = useState<MySelfBilledInvoice[] | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/atelier/me/self-billing`, {
        headers: { ...authHeader(), Accept: "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const j = (await res.json()) as { items: MySelfBilledInvoice[] };
      setItems(j.items);
    } catch {
      setItems([]);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  return { items, reload: load };
}

function SelfBillingSection() {
  const c = useColors();
  const rtl = useRTL();
  const feedback = useFeedback();
  const { items, reload } = useMySelfBilling();
  const [disputeFor, setDisputeFor] = useState<MySelfBilledInvoice | null>(null);
  const [disputeText, setDisputeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const openPdf = useCallback(async (inv: MySelfBilledInvoice) => {
    const url = `${API_BASE}/api/atelier/me/self-billing/${inv.id}/pdf`;
    if (Platform.OS === "web") {
      Linking.openURL(url);
      return;
    }
    setDownloading(inv.id);
    try {
      const FileSystem = getFileSystem();
      const Sharing = getSharing();
      if (!FileSystem || !Sharing) throw new Error("Native file modules unavailable");
      const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
      const dest = `${dir}${Date.now()}_${inv.invoiceNumber.replace(/[^\w.\-]+/g, "_")}.pdf`;
      const result = await FileSystem.downloadAsync(url, dest, { headers: authHeader() });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(result.uri);
      hapticSuccess();
    } catch {
      hapticError();
      feedback.toast("Download failed", "error");
    } finally {
      setDownloading(null);
    }
  }, [feedback]);

  const submitDispute = useCallback(async () => {
    if (!disputeFor || !disputeText.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/atelier/me/self-billing/${disputeFor.id}/dispute`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: disputeText.trim() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
        throw new Error(j?.message ?? j?.error ?? `${res.status}`);
      }
      hapticSuccess();
      setDisputeFor(null);
      setDisputeText("");
      await reload();
    } catch (e) {
      hapticError();
      feedback.toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }, [disputeFor, disputeText, reload, feedback]);

  if (!items || items.length === 0) return null;

  const tone = (s: MySelfBilledInvoice["status"]) =>
    s === "paid" ? "#2E9E62" : s === "disputed" ? c.destructive : c.mutedForeground;

  return (
    <View style={{ gap: 12 }}>
      <Text
        style={{
          color: c.foreground,
          fontFamily: "PlusJakartaSans_800ExtraBold",
          fontSize: 17,
          letterSpacing: -0.2,
          textAlign: rtl.textAlign,
          marginTop: 4,
        }}
      >
        Self-billed invoices
      </Text>
      {items.map((inv) => (
        <Card key={inv.id} style={{ gap: 8 }}>
          <View style={{ flexDirection: rtl.row, alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_700Bold", fontSize: 14 }}>
              {inv.invoiceNumber}
            </Text>
            <Chip label={inv.status} color={tone(inv.status)} />
          </View>
          <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 13, textAlign: rtl.textAlign }}>
            Week {inv.weekIso} · {inv.currency} {inv.totalAmount.toFixed(2)}
            {inv.status === "paid" && inv.remittanceRef ? ` · remittance ${inv.remittanceRef}` : ""}
          </Text>
          {inv.status === "disputed" && inv.disputeReason ? (
            <Text style={{ color: c.destructive, fontFamily: "PlusJakartaSans_400Regular", fontSize: 12, textAlign: rtl.textAlign }}>
              Disputed: {inv.disputeReason}
            </Text>
          ) : null}
          <View style={{ flexDirection: rtl.row, gap: 10 }}>
            <PressScale onPress={() => openPdf(inv)}>
              <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 6, paddingVertical: 6 }}>
                {downloading === inv.id ? (
                  <ActivityIndicator size="small" color={c.primary} />
                ) : (
                  <Feather name="download" size={15} color={c.primary} />
                )}
                <Text style={{ color: c.primary, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13 }}>PDF</Text>
              </View>
            </PressScale>
            {(inv.status === "draft" || inv.status === "approved") && (
              <PressScale onPress={() => { setDisputeFor(inv); setDisputeText(""); }}>
                <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 6, paddingVertical: 6 }}>
                  <Feather name="alert-circle" size={15} color={c.destructive} />
                  <Text style={{ color: c.destructive, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13 }}>Dispute</Text>
                </View>
              </PressScale>
            )}
          </View>
        </Card>
      ))}
      <Modal visible={!!disputeFor} animationType="slide" transparent onRequestClose={() => setDisputeFor(null)}>
        <Pressable onPress={() => setDisputeFor(null)} style={{ flex: 1, backgroundColor: c.scrim, justifyContent: "center", padding: 24 }}>
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={[{ backgroundColor: c.card, borderRadius: 24, padding: 20, gap: 12 }, softShadow(c.shadow)]}>
              <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_700Bold", fontSize: 16 }}>
                Dispute {disputeFor?.invoiceNumber}
              </Text>
              <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 13 }}>
                Tell finance what looks wrong. The invoice is held out of payment runs until it is resolved.
              </Text>
              <TextInput
                value={disputeText}
                onChangeText={setDisputeText}
                placeholder="e.g. hours for Engagement X are overstated"
                placeholderTextColor={c.mutedForeground}
                multiline
                style={{
                  minHeight: 80,
                  borderWidth: 1,
                  borderColor: c.tint25,
                  borderRadius: 14,
                  padding: 12,
                  color: c.foreground,
                  fontFamily: "PlusJakartaSans_400Regular",
                  fontSize: 14,
                  textAlignVertical: "top",
                }}
              />
              <View style={{ flexDirection: rtl.row, gap: 10, justifyContent: "flex-end" }}>
                <Button label="Cancel" variant="secondary" onPress={() => setDisputeFor(null)} />
                <Button
                  label={busy ? "Sending…" : "Submit dispute"}
                  onPress={submitDispute}
                  disabled={busy || !disputeText.trim()}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ============================================================
// Task #850 — official employment & salary letters (Task #845 API).
// Bespoke /me/letters routes are not in the openapi spec: raw fetch.
// Employees only — the server 403s contractors, so the section simply
// hides itself when the list can't load.
// ============================================================
interface MyLetterType {
  id: string;
  label: string;
  hint: string;
  salaryBearing: boolean;
  travelDates: boolean;
}

interface MyLetter {
  id: string;
  letterLabel: string;
  language: "en" | "ar" | "tr";
  deliveryMode: "digital" | "wet_signature";
  refNumber: string;
  entityName: string;
  signatoryName: string | null;
  status: string;
  emailTo: string | null;
  delivered: boolean;
  documentId: string | null;
  fileName: string | null;
  createdAt: string;
}

/** POST /me/letters/preview response — the confirm-step summary (Task #862). */
interface LetterPreviewPayload {
  ok: true;
  entity: {
    name: string;
    signatoryName: string | null;
    signatoryTitle: string | null;
  };
  salary: { hasSalary: boolean; currency?: string };
}
interface MyLettersPayload {
  letters: MyLetter[];
  catalog: MyLetterType[];
  entity: { wetSignatureAvailable: boolean; signatoryName: string | null } | null;
}

function useMyLetters() {
  const [data, setData] = useState<MyLettersPayload | null>(null);
  const [allowed, setAllowed] = useState(true);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/atelier/me/letters`, {
        headers: { ...authHeader(), Accept: "application/json" },
        credentials: "include",
      });
      if (res.status === 403) {
        setAllowed(false);
        return;
      }
      if (!res.ok) throw new Error(`${res.status}`);
      setData((await res.json()) as MyLettersPayload);
    } catch {
      // Leave whatever we had; a transient failure shouldn't hide history.
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);
  return { data, allowed, reload: load };
}

function letterStatusText(l: MyLetter): { label: string; pending: boolean } {
  if (l.deliveryMode === "wet_signature") {
    if (l.status === "sent_to_signatory")
      return {
        label: `Sent to ${l.signatoryName ?? "signatory"} — awaiting hand-over`,
        pending: true,
      };
    // Task #863 — final state once the signatory/HR marks the signed hard
    // copy as handed to the employee.
    if (l.status === "handed_over")
      return { label: "Signed and handed over", pending: false };
    return { label: l.status.replace(/_/g, " "), pending: false };
  }
  if (l.delivered) return { label: `Emailed to ${l.emailTo ?? "you"}`, pending: false };
  return { label: "Issued — download below", pending: false };
}

// ============================================================
// Task #1002 — personal tasks & reminders (self-scope /me/tasks).
// Lightweight list: add, complete/reopen, delete. Chat-created
// reminders ("remind me to call Dr. Hassan at 5pm") show here too.
// ============================================================
// Task #1010 — opt-in device push for due reminders. The toggle only
// flips after the server registration/unregistration succeeds.
function TaskPushToggle() {
  const c = useColors();
  const rtl = useRTL();
  const feedback = useFeedback();
  const [enabled, setEnabled] = useState(getPushEnabledSync());
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    let live = true;
    void loadPushEnabled().then((v) => { if (live) setEnabled(v); });
    const un = subscribePushEnabled((v) => setEnabled(v));
    return () => { live = false; un(); };
  }, []);

  if (!pushSupported()) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (enabled) {
        await disableTaskPush();
        feedback.toast("Phone alerts off", "success");
      } else {
        const perm = await enableTaskPush();
        if (perm === "blocked") {
          feedback.toast("Notifications are blocked — enable them in system Settings", "error");
        } else if (perm === "denied") {
          feedback.toast("Notification permission was not granted", "error");
        } else {
          hapticSuccess();
          feedback.toast("Phone alerts on — reminders will reach this device", "success");
        }
      }
    } catch (e) {
      hapticError();
      feedback.toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={() => void toggle()}
      disabled={busy}
      style={{ flexDirection: rtl.row, alignItems: "center", gap: 8, opacity: busy ? 0.6 : 1 }}
      testID="toggle-task-push"
    >
      <Feather name={enabled ? "bell" : "bell-off"} size={15} color={enabled ? c.accent : c.mutedForeground} />
      <Text style={{ color: c.mutedForeground, fontSize: 13, flex: 1, textAlign: rtl.textAlign }}>
        Phone alerts for due reminders
      </Text>
      {busy ? (
        <ActivityIndicator size="small" color={c.accent} />
      ) : (
        <Chip label={enabled ? "On" : "Off"} color={enabled ? c.accent : c.mutedForeground} />
      )}
    </Pressable>
  );
}

function MyTasksSection() {
  const c = useColors();
  const rtl = useRTL();
  const feedback = useFeedback();
  const { t } = useI18n();
  const list = useAtelierListMyTasks();
  const createTask = useAtelierCreateMyTask();
  const updateTask = useAtelierUpdateMyTask();
  const deleteTask = useAtelierDeleteMyTask();
  const [title, setTitle] = useState("");

  // Refresh whenever the Me tab regains focus (chat writes elsewhere).
  const refetch = list.refetch;
  const firstFocus = React.useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refetch();
    }, [refetch]),
  );

  const tasks = list.data?.tasks ?? [];
  const open = tasks.filter((x) => x.status === "open");
  const done = tasks.filter((x) => x.status === "done").slice(0, 3);

  const add = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await createTask.mutateAsync({ data: { title: trimmed } });
      setTitle("");
      await refetch();
      hapticSuccess();
    } catch {
      hapticError();
      feedback.toast(t("common.error"), "error");
    }
  }, [title, createTask, refetch, feedback, t]);

  const setStatus = useCallback(
    async (id: string, status: "open" | "done") => {
      try {
        await updateTask.mutateAsync({ id, data: { status } });
        await refetch();
        hapticSuccess();
      } catch {
        hapticError();
        feedback.toast(t("common.error"), "error");
      }
    },
    [updateTask, refetch, feedback, t],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteTask.mutateAsync({ id });
        await refetch();
      } catch {
        hapticError();
        feedback.toast(t("common.error"), "error");
      }
    },
    [deleteTask, refetch, feedback, t],
  );

  const fmtDue = (iso: string | null | undefined) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
        <Feather name="check-circle" size={16} color={c.accent} />
        <Text style={{ color: c.text, fontWeight: "700", fontSize: 15, flex: 1, textAlign: rtl.textAlign }}>
          My tasks & reminders
        </Text>
        {open.length > 0 ? <Chip label={`${open.length} open`} /> : null}
      </View>
      <TaskPushToggle />
      <View style={{ flexDirection: rtl.row, gap: 8, alignItems: "center" }}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Add a task…"
          placeholderTextColor={c.mutedForeground}
          onSubmitEditing={add}
          returnKeyType="done"
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 10,
            paddingHorizontal: 10,
            paddingVertical: 8,
            color: c.text,
            textAlign: rtl.textAlign,
          }}
          testID="input-mobile-task-title"
        />
        <Pressable
          onPress={add}
          disabled={!title.trim() || createTask.isPending}
          style={{ opacity: !title.trim() || createTask.isPending ? 0.5 : 1, padding: 8 }}
          testID="button-mobile-task-add"
        >
          <Feather name="plus-circle" size={22} color={c.accent} />
        </Pressable>
      </View>
      {list.isLoading ? <Skeleton height={40} /> : null}
      {!list.isLoading && open.length === 0 ? (
        <Text style={{ color: c.mutedForeground, fontSize: 13, textAlign: rtl.textAlign }}>
          Nothing open. Add one above — or ask Riser to “remind me to call Dr. Hassan at 5pm”.
        </Text>
      ) : null}
      {open.map((task) => {
        const dueTxt = fmtDue(task.dueAt);
        return (
          <View
            key={task.id}
            style={{ flexDirection: rtl.row, alignItems: "center", gap: 10, paddingVertical: 4 }}
            testID={`row-mobile-task-${task.id}`}
          >
            <Pressable onPress={() => void setStatus(task.id, "done")} hitSlop={8} testID={`button-mobile-task-done-${task.id}`}>
              <Feather name="circle" size={18} color={c.mutedForeground} />
            </Pressable>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: c.text, fontSize: 14, textAlign: rtl.textAlign }} numberOfLines={2}>
                {task.title}
              </Text>
              {dueTxt ? (
                <Text
                  style={{ color: task.overdue ? c.destructive : c.mutedForeground, fontSize: 11, textAlign: rtl.textAlign }}
                >
                  {dueTxt}
                  {task.overdue ? " · overdue" : ""}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => void remove(task.id)} hitSlop={8} testID={`button-mobile-task-delete-${task.id}`}>
              <Feather name="trash-2" size={16} color={c.mutedForeground} />
            </Pressable>
          </View>
        );
      })}
      {done.map((task) => (
        <View
          key={task.id}
          style={{ flexDirection: rtl.row, alignItems: "center", gap: 10, paddingVertical: 2, opacity: 0.6 }}
        >
          <Pressable onPress={() => void setStatus(task.id, "open")} hitSlop={8} testID={`button-mobile-task-reopen-${task.id}`}>
            <Feather name="check-circle" size={18} color={c.accent} />
          </Pressable>
          <Text
            style={{ color: c.mutedForeground, fontSize: 14, flex: 1, textDecorationLine: "line-through", textAlign: rtl.textAlign }}
            numberOfLines={1}
          >
            {task.title}
          </Text>
        </View>
      ))}
    </Card>
  );
}

function LettersSection() {
  const c = useColors();
  const rtl = useRTL();
  const feedback = useFeedback();
  const { data, allowed, reload } = useMyLetters();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [letterType, setLetterType] = useState<string | null>(null);
  const [language, setLanguage] = useState<"en" | "ar" | "tr">("en");
  const [wet, setWet] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [travelStart, setTravelStart] = useState("");
  const [travelEnd, setTravelEnd] = useState("");
  const [busy, setBusy] = useState(false);
  // Confirm step (Task #862): preview result held here means "awaiting confirm".
  const [preview, setPreview] = useState<LetterPreviewPayload | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  const downloadPdf = useCallback(
    async (l: MyLetter) => {
      if (!l.documentId) return;
      const url = `${API_BASE}/api/atelier/me/documents/${l.documentId}/download`;
      if (Platform.OS === "web") {
        Linking.openURL(url);
        return;
      }
      setDownloading(l.id);
      try {
        const FileSystem = getFileSystem();
        const Sharing = getSharing();
        if (!FileSystem || !Sharing) throw new Error("Native file modules unavailable");
        const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
        const safe = (l.fileName || `${l.refNumber}.pdf`).replace(/[^\w.\-]+/g, "_");
        const dest = `${dir}${Date.now()}_${safe}`;
        const result = await FileSystem.downloadAsync(url, dest, { headers: authHeader() });
        if (result.status && result.status >= 400) throw new Error(`${result.status}`);
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(result.uri);
        hapticSuccess();
      } catch {
        hapticError();
        feedback.toast("Download failed", "error");
      } finally {
        setDownloading(null);
      }
    },
    [feedback],
  );

  const catalog = data?.catalog ?? [];
  const def = catalog.find((t) => t.id === letterType) ?? null;
  const needsTravel = !!def?.travelDates;
  const dateOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const travelMissing = needsTravel && (!dateOk(travelStart) || !dateOk(travelEnd));

  const buildBody = useCallback((): Record<string, string> => {
    const body: Record<string, string> = {
      letterType: letterType ?? "",
      language,
      deliveryMode: wet ? "wet_signature" : "digital",
    };
    if (purpose.trim()) body.purpose = purpose.trim();
    if (needsTravel) {
      body.travelStart = travelStart;
      body.travelEnd = travelEnd;
    }
    return body;
  }, [letterType, language, wet, purpose, needsTravel, travelStart, travelEnd]);

  // Step 1 — call the preview endpoint so the employee sees who signs and
  // whether salary figures will appear before anything is generated or
  // emailed (parity with the chat confirm card, Task #862).
  const requestPreview = useCallback(async () => {
    if (!letterType || busy || travelMissing) return;
    setBusy(true);
    setPreviewErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/atelier/me/letters/preview`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(buildBody()),
      });
      const j = (await res.json().catch(() => null)) as
        | (LetterPreviewPayload & { message?: string; error?: string })
        | null;
      if (!res.ok || !j?.ok) throw new Error(j?.message ?? j?.error ?? `${res.status}`);
      setPreview(j);
    } catch (e) {
      hapticError();
      feedback.toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }, [letterType, busy, travelMissing, buildBody, feedback]);

  // Step 2 — confirmed: actually issue the letter.
  const confirmIssue = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setPreviewErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/atelier/me/letters`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(buildBody()),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null;
        throw new Error(j?.message ?? j?.error ?? `${res.status}`);
      }
      hapticSuccess();
      feedback.toast("Letter issued", "success");
      setFormOpen(false);
      setPreview(null);
      setLetterType(null);
      setPurpose("");
      setTravelStart("");
      setTravelEnd("");
      setWet(false);
      await reload();
    } catch (e) {
      hapticError();
      setPreviewErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, buildBody, reload, feedback]);

  if (!allowed || !data) return null;

  const inputStyle = {
    borderWidth: 1,
    borderColor: c.tint25,
    borderRadius: 14,
    padding: 12,
    color: c.foreground,
    fontFamily: "PlusJakartaSans_400Regular",
    fontSize: 14,
  } as const;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: rtl.row, alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        <Text
          style={{
            color: c.foreground,
            fontFamily: "PlusJakartaSans_800ExtraBold",
            fontSize: 17,
            letterSpacing: -0.2,
            textAlign: rtl.textAlign,
          }}
        >
          Official letters
        </Text>
        <PressScale
          onPress={() => {
            setPreview(null);
            setPreviewErr(null);
            setFormOpen(true);
          }}
        >
          <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 6, paddingVertical: 6 }}>
            <Feather name="plus" size={15} color={c.primary} />
            <Text style={{ color: c.primary, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13 }}>
              Request
            </Text>
          </View>
        </PressScale>
      </View>
      {data.letters.length === 0 ? (
        <Card>
          <Text
            style={{
              color: c.mutedForeground,
              fontFamily: "PlusJakartaSans_400Regular",
              fontSize: 13,
              textAlign: rtl.textAlign,
            }}
          >
            No letters yet. Request a salary certificate, employment verification or visa
            letter and it will appear here for re-download.
          </Text>
        </Card>
      ) : (
        data.letters.map((l) => {
          const st = letterStatusText(l);
          return (
            <Card key={l.id} style={{ gap: 8 }}>
              <View style={{ flexDirection: rtl.row, alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text
                  style={{ color: c.foreground, fontFamily: "PlusJakartaSans_700Bold", fontSize: 14, flexShrink: 1, textAlign: rtl.textAlign }}
                >
                  {l.letterLabel}
                </Text>
                <Chip label={l.refNumber} color={c.mutedForeground} />
              </View>
              <Text
                style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 13, textAlign: rtl.textAlign }}
              >
                {new Date(l.createdAt).toLocaleDateString()} ·{" "}
                {l.language === "en" ? "English" : l.language === "ar" ? "Arabic" : "Turkish"} ·{" "}
                {l.deliveryMode === "wet_signature" ? "Wet signature" : "Digital"} · {l.entityName}
              </Text>
              <Text
                style={{
                  color: st.pending ? "#B8860B" : c.mutedForeground,
                  fontFamily: "PlusJakartaSans_500Medium",
                  fontSize: 12,
                  textAlign: rtl.textAlign,
                }}
              >
                {st.label}
              </Text>
              {l.documentId ? (
                <PressScale onPress={() => downloadPdf(l)}>
                  <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 6, paddingVertical: 6 }}>
                    {downloading === l.id ? (
                      <ActivityIndicator size="small" color={c.primary} />
                    ) : (
                      <Feather name="download" size={15} color={c.primary} />
                    )}
                    <Text style={{ color: c.primary, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13 }}>
                      PDF
                    </Text>
                  </View>
                </PressScale>
              ) : null}
            </Card>
          );
        })
      )}

      <Modal visible={formOpen} animationType="slide" transparent onRequestClose={() => setFormOpen(false)}>
        <Pressable
          onPress={() => setFormOpen(false)}
          style={{ flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end" }}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={[{ backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12, maxHeight: "88%" }, softShadow(c.shadow)]}>
              {preview ? (
                <ScrollView contentContainerStyle={{ gap: 12 }}>
                  <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_700Bold", fontSize: 16, textAlign: rtl.textAlign }}>
                    Confirm before issuing
                  </Text>
                  <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 13, textAlign: rtl.textAlign }}>
                    Nothing has been generated or emailed yet — review the details below.
                  </Text>
                  <View style={{ gap: 8 }}>
                    <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, textAlign: rtl.textAlign }}>
                      {def?.label ?? letterType} ·{" "}
                      {language === "en" ? "English" : language === "ar" ? "Arabic" : "Turkish"} ·{" "}
                      {wet ? "Wet signature" : "Digital"}
                    </Text>
                    <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, textAlign: rtl.textAlign }}>
                      Issued by {preview.entity.name}
                    </Text>
                    <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, textAlign: rtl.textAlign }}>
                      {preview.entity.signatoryName
                        ? `Signed by ${preview.entity.signatoryName}${preview.entity.signatoryTitle ? `, ${preview.entity.signatoryTitle}` : ""}`
                        : "No named signatory on file"}
                    </Text>
                    {def?.salaryBearing ? (
                      <Text
                        style={{
                          color: preview.salary.hasSalary ? c.foreground : "#B8860B",
                          fontFamily: "PlusJakartaSans_500Medium",
                          fontSize: 13,
                          textAlign: rtl.textAlign,
                        }}
                      >
                        {preview.salary.hasSalary
                          ? `Salary figures will appear${preview.salary.currency ? ` (${preview.salary.currency})` : ""} — from your compensation record`
                          : "No salary data on file — the letter will omit salary figures"}
                      </Text>
                    ) : null}
                    <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 13, textAlign: rtl.textAlign }}>
                      {wet
                        ? `Sent to ${preview.entity.signatoryName ?? "the signatory"} to print, sign and hand over`
                        : "Emailed to your Cognirise inbox"}
                    </Text>
                  </View>
                  {previewErr ? (
                    <Text style={{ color: "#B00020", fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, textAlign: rtl.textAlign }}>
                      {previewErr}
                    </Text>
                  ) : null}
                  <View style={{ flexDirection: rtl.row, gap: 10, justifyContent: "flex-end" }}>
                    <Button
                      label="Back"
                      variant="secondary"
                      onPress={() => {
                        setPreview(null);
                        setPreviewErr(null);
                      }}
                      disabled={busy}
                    />
                    <Button
                      label={busy ? "Issuing…" : "Confirm & issue"}
                      onPress={confirmIssue}
                      disabled={busy}
                    />
                  </View>
                </ScrollView>
              ) : (
              <ScrollView contentContainerStyle={{ gap: 12 }}>
                <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_700Bold", fontSize: 16 }}>
                  Request a letter
                </Text>
                {catalog.map((t) => (
                  <PressScale key={t.id} onPress={() => setLetterType(t.id)}>
                    <View
                      style={{
                        borderWidth: 1.5,
                        borderColor: letterType === t.id ? c.primary : c.tint25,
                        borderRadius: 14,
                        padding: 12,
                        gap: 2,
                      }}
                    >
                      <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13 }}>
                        {t.label}
                      </Text>
                      <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 12 }}>
                        Use {t.hint}.
                      </Text>
                    </View>
                  </PressScale>
                ))}
                <View style={{ flexDirection: rtl.row, gap: 8 }}>
                  {(["en", "ar", "tr"] as const).map((lng) => (
                    <PressScale key={lng} onPress={() => setLanguage(lng)}>
                      <View
                        style={{
                          borderWidth: 1.5,
                          borderColor: language === lng ? c.primary : c.tint25,
                          borderRadius: 999,
                          paddingHorizontal: 14,
                          paddingVertical: 7,
                        }}
                      >
                        <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 12 }}>
                          {lng === "en" ? "English" : lng === "ar" ? "Arabic" : "Turkish"}
                        </Text>
                      </View>
                    </PressScale>
                  ))}
                </View>
                {data.entity?.wetSignatureAvailable ? (
                  <PressScale onPress={() => setWet((v) => !v)}>
                    <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
                      <Feather name={wet ? "check-square" : "square"} size={17} color={c.primary} />
                      <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, flexShrink: 1 }}>
                        Wet signature — printed &amp; signed
                        {data.entity.signatoryName ? ` by ${data.entity.signatoryName}` : ""}
                      </Text>
                    </View>
                  </PressScale>
                ) : null}
                <TextInput
                  value={purpose}
                  onChangeText={setPurpose}
                  placeholder="Purpose (optional), e.g. home loan application"
                  placeholderTextColor={c.mutedForeground}
                  style={inputStyle}
                  maxLength={500}
                />
                {needsTravel ? (
                  <View style={{ flexDirection: rtl.row, gap: 8 }}>
                    <TextInput
                      value={travelStart}
                      onChangeText={setTravelStart}
                      placeholder="Travel start YYYY-MM-DD"
                      placeholderTextColor={c.mutedForeground}
                      style={[inputStyle, { flex: 1 }]}
                    />
                    <TextInput
                      value={travelEnd}
                      onChangeText={setTravelEnd}
                      placeholder="Travel end YYYY-MM-DD"
                      placeholderTextColor={c.mutedForeground}
                      style={[inputStyle, { flex: 1 }]}
                    />
                  </View>
                ) : null}
                <View style={{ flexDirection: rtl.row, gap: 10, justifyContent: "flex-end" }}>
                  <Button label="Cancel" variant="secondary" onPress={() => setFormOpen(false)} />
                  <Button
                    label={busy ? "Checking…" : "Review & issue"}
                    onPress={requestPreview}
                    disabled={busy || !letterType || travelMissing}
                  />
                </View>
              </ScrollView>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ============================================================
// Task #797 — native upload of ID scans from the Me tab.
// Mirrors the server contract in meProfileRoutes.ts: PDF/JPEG/PNG/WebP,
// ≤15 MB, and a national ID needs front+back scans or one combined PDF.
// ============================================================
type PickedScan = { uri: string; name: string; mime: string; size: number | null };

const SCAN_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const SCAN_MAX_BYTES = 15 * 1024 * 1024;

const DOC_KINDS = ["passport", "national_id", "residency", "visa", "other"] as const;

/** React Native fetch/FormData file descriptor (same trick as the photo upload). */
function toRnFile(f: PickedScan): Blob {
  return { uri: f.uri, name: f.name, type: f.mime } as unknown as Blob;
}

function docIcon(kind: string): React.ComponentProps<typeof Feather>["name"] {
  const k = kind.toLowerCase();
  if (k.includes("passport")) return "book";
  if (k.includes("visa") || k.includes("residency") || k.includes("permit")) return "credit-card";
  if (k.includes("id") || k.includes("national")) return "user";
  if (k.includes("contract")) return "file-text";
  if (k.includes("certif") || k.includes("degree")) return "award";
  return "file";
}

/** Escape vCard text values per RFC 6350 (backslash, comma, semicolon, newline). */
function vEsc(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function vCard(name: string, title: string, email: string, phone: string): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${vEsc(name)}`,
    `FN:${vEsc(name)}`,
    "ORG:Cognirise",
    title ? `TITLE:${vEsc(title)}` : "",
    email ? `EMAIL;TYPE=WORK:${vEsc(email)}` : "",
    phone ? `TEL;TYPE=CELL:${vEsc(phone)}` : "",
    "END:VCARD",
  ].filter(Boolean);
  return lines.join("\n");
}

export default function MeScreen() {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  const insets = useSafeAreaInsets();
  const feedback = useFeedback();

  const profile = useAtelierGetMyProfile();
  const docs = useAtelierListMyDocuments();
  const uploadPhoto = useAtelierUploadMyPhoto();

  // Task #828 — refetch the document list whenever the Me tab regains
  // focus, so out-of-band changes (chat writes, another device) surface
  // without restarting the app.
  const refetchDocs = docs.refetch;
  const focusedOnceRef = React.useRef(false);
  useFocusEffect(
    useCallback(() => {
      // Skip the very first focus — the initial query fetch already runs.
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      void refetchDocs();
    }, [refetchDocs]),
  );

  const [qrOpen, setQrOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const user = profile.data?.user;
  const person = profile.data?.person;

  const name = user?.name ?? person?.fullName ?? "";
  const title = user?.title ?? person?.title ?? "";
  const email = user?.email ?? person?.email ?? "";
  const phone = person?.cellPhones?.[0]?.number ?? "";
  const avatarUrl = user?.avatarUrl ?? person?.avatarUrl ?? null;

  const card = useMemo(() => vCard(name, title, email, phone), [name, title, email, phone]);

  const changePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      feedback.toast(t("perm.photos"), "error");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    try {
      const file = {
        uri: asset.uri,
        name: asset.fileName ?? `photo_${Date.now()}.jpg`,
        type: asset.mimeType ?? "image/jpeg",
      } as unknown as Blob;
      await uploadPhoto.mutateAsync({ data: { file } });
      await profile.refetch();
      hapticSuccess();
    } catch {
      hapticError();
      feedback.toast(t("common.error"), "error");
    }
  }, [uploadPhoto, profile, t, feedback]);

  const openDocument = useCallback(
    async (doc: AtelierSelfDocument, side: "front" | "back" | "all" = "front") => {
      if (side === "back" ? !doc.hasBackFile : !doc.hasFile) return;
      if (Platform.OS !== "web") setDownloadingId(`${doc.id}:${side}`);
      try {
        const FileSystem = Platform.OS === "web" ? null : getFileSystem();
        const Sharing = Platform.OS === "web" ? null : getSharing();
        const result = await openDocumentFile(doc, side, {
          apiBase: API_BASE,
          buildDownloadPath: getAtelierDownloadMyDocumentUrl,
          authHeader,
          platformOS: Platform.OS,
          openWebUrl: (url) => Linking.openURL(url),
          // Task #838 — web probes the route first so a missing back side
          // shows a friendly message instead of a raw JSON error page.
          probeStatus: async (url, headers) => {
            const res = await fetch(url, { method: "HEAD", headers, credentials: "include" });
            return res.status;
          },
          downloadAsync: (url, dest, options) => FileSystem!.downloadAsync(url, dest, options),
          cacheDirectory: FileSystem ? (FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "") : "",
          isSharingAvailable: () => Sharing!.isAvailableAsync(),
          shareAsync: (uri) => Sharing!.shareAsync(uri),
        });
        if (result.status === "missing_file") {
          hapticError();
          feedback.toast(side === "back" ? t("me.idBackNotOnFile") : t("me.docNotOnFile"), "error");
          void docs.refetch(); // clear stale hasFile/hasBackFile flags
        } else if (result.status === "error") {
          hapticError();
          feedback.toast(t("me.downloadFailed"), "error");
        } else if (result.status !== "opened_web" && result.status !== "skipped_no_file") {
          hapticSuccess();
        }
      } catch {
        hapticError();
        feedback.toast(t("me.downloadFailed"), "error");
      } finally {
        setDownloadingId(null);
      }
    },
    [t, feedback, docs],
  );

  // ------------------------------------------------------------------
  // Task #797 — add / replace ID document scans natively.
  // ------------------------------------------------------------------
  const createDoc = useAtelierCreateMyDocument();
  const replaceScan = useAtelierReplaceMyDocumentScan();

  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<(typeof DOC_KINDS)[number]>("passport");
  const [addTitle, setAddTitle] = useState("");
  const [addExpires, setAddExpires] = useState("");
  const [addFront, setAddFront] = useState<PickedScan | null>(null);
  const [addBack, setAddBack] = useState<PickedScan | null>(null);
  const [docActionsFor, setDocActionsFor] = useState<AtelierSelfDocument | null>(null);
  // Which scan slot the source sheet is picking for. Kept in a ref because
  // the Sheet closes (and clears its own visibility) BEFORE the deferred
  // picker action runs — the target must survive that dismissal.
  type ScanTarget =
    | { kind: "add"; slot: "front" | "back" }
    | { kind: "replace"; docId: string; side: "front" | "back" };
  const scanTargetRef = React.useRef<ScanTarget | null>(null);
  const [scanSheetOpen, setScanSheetOpen] = useState(false);
  // iOS shows only the top-most modal: the add-document Modal must stay
  // hidden while the source sheet or a native picker is presenting.
  const [pickerActive, setPickerActive] = useState(false);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  const openScanSheet = useCallback((target: ScanTarget) => {
    scanTargetRef.current = target;
    setScanSheetOpen(true);
  }, []);

  const validateScan = useCallback(
    (f: PickedScan): boolean => {
      if (!SCAN_MIMES.has(f.mime)) {
        hapticError();
        feedback.toast(t("me.docBadType"), "error");
        return false;
      }
      if (f.size != null && f.size > SCAN_MAX_BYTES) {
        hapticError();
        feedback.toast(t("me.docTooLarge"), "error");
        return false;
      }
      return true;
    },
    [t, feedback],
  );

  const applyScanError = useCallback(
    (e: unknown) => {
      hapticError();
      const data = (e as { data?: { message?: string; error?: string } } | null)?.data;
      const msg =
        (typeof data?.message === "string" && data.message) ||
        (data?.error === "back-side-required" ? t("me.docBackRequired") : null) ||
        (data?.error === "unsupported-file-type" ? t("me.docBadType") : null) ||
        t("common.error");
      feedback.toast(msg, "error");
    },
    [t, feedback],
  );

  const deliverPickedScan = useCallback(
    async (f: PickedScan) => {
      const target = scanTargetRef.current;
      scanTargetRef.current = null;
      if (!target || !validateScan(f)) return;
      if (target.kind === "add") {
        if (target.slot === "front") setAddFront(f);
        else setAddBack(f);
        return;
      }
      setReplacingId(target.docId);
      try {
        await replaceScan.mutateAsync({
          id: target.docId,
          data: { file: toRnFile(f), side: target.side },
        });
        await docs.refetch();
        hapticSuccess();
        feedback.toast(t("me.scanReplaced"), "success");
      } catch (e) {
        applyScanError(e);
      } finally {
        setReplacingId(null);
      }
    },
    [validateScan, replaceScan, docs, t, feedback, applyScanError],
  );

  const pickScanFromInner = useCallback(
    async (mode: "camera" | "library" | "file") => {
      if (mode === "file") {
        const out = await runExclusivePick(() =>
          DocumentPicker.getDocumentAsync({
            type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
            copyToCacheDirectory: true,
            multiple: false,
          }),
        );
        if (!out.ok) {
          if (out.reason === "failed") feedback.toast(t("picker.failed"), "error");
          return;
        }
        const res = out.value;
        if (res.canceled || !res.assets?.[0]) return;
        const a = res.assets[0];
        await deliverPickedScan({
          uri: a.uri,
          name: a.name ?? `scan_${Date.now()}.pdf`,
          mime: a.mimeType ?? "application/pdf",
          size: a.size ?? null,
        });
        return;
      }
      const perm =
        mode === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        feedback.toast(t(mode === "camera" ? "perm.camera" : "perm.photos"), "error");
        return;
      }
      const out = await runExclusivePick(() =>
        mode === "camera"
          ? ImagePicker.launchCameraAsync({ quality: 0.8 })
          : ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 }),
      );
      if (!out.ok) {
        if (out.reason === "failed") feedback.toast(t("picker.failed"), "error");
        return;
      }
      const res = out.value;
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      await deliverPickedScan({
        uri: a.uri,
        name: a.fileName ?? `scan_${Date.now()}.jpg`,
        mime: a.mimeType ?? "image/jpeg",
        size: a.fileSize ?? null,
      });
    },
    [deliverPickedScan, t, feedback],
  );

  const pickScanFrom = useCallback(
    async (mode: "camera" | "library" | "file") => {
      // pickerActive was already set at option-tap time (onOptionSelected)
      // so the add modal stayed hidden across the sheet-dismiss → pick gap.
      setPickerActive(true);
      try {
        await pickScanFromInner(mode);
      } finally {
        // Let the native picker finish dismissing before the add modal is
        // allowed to re-present (iOS shows only the top-most modal).
        if (Platform.OS === "web") setPickerActive(false);
        else setTimeout(() => setPickerActive(false), 400);
      }
    },
    [pickScanFromInner],
  );

  const resetAddForm = useCallback(() => {
    setAddKind("passport");
    setAddTitle("");
    setAddExpires("");
    setAddFront(null);
    setAddBack(null);
  }, []);

  const submitAdd = useCallback(async () => {
    const title = addTitle.trim();
    if (!title) {
      hapticError();
      feedback.toast(t("me.docTitleRequired"), "error");
      return;
    }
    const expires = addExpires.trim();
    if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
      hapticError();
      feedback.toast(t("me.docBadDate"), "error");
      return;
    }
    // Same rule as the server: a national ID front image needs a back scan
    // (a single combined PDF is fine on its own).
    if (
      addKind === "national_id" &&
      addFront &&
      addFront.mime !== "application/pdf" &&
      !addBack
    ) {
      hapticError();
      feedback.toast(t("me.docBackRequired"), "error");
      return;
    }
    try {
      await createDoc.mutateAsync({
        data: {
          kind: addKind,
          title,
          ...(expires ? { expiresAt: expires } : {}),
          ...(addFront ? { file: toRnFile(addFront) } : {}),
          ...(addKind === "national_id" && addBack ? { fileBack: toRnFile(addBack) } : {}),
        },
      });
      await docs.refetch();
      hapticSuccess();
      feedback.toast(t("me.docSaved"), "success");
      setAddOpen(false);
      resetAddForm();
    } catch (e) {
      applyScanError(e);
    }
  }, [addTitle, addExpires, addKind, addFront, addBack, createDoc, docs, t, feedback, resetAddForm, applyScanError]);


  const bottomPad = (Platform.OS === "web" ? WEB_TAB_BAR : insets.bottom + 90) + 24;
  const documents = docs.data?.documents ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppBackground />
      {/* Task #1003 — unified glass header with brand logo. */}
      <AppHeader title={t("me.title")} />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: bottomPad }}>
        {profile.isLoading ? (
          <Card style={{ alignItems: "center", gap: 12 }}>
            <Skeleton height={88} width={88} style={{ borderRadius: 44 }} />
            <Skeleton height={18} width="50%" />
            <Skeleton height={14} width="40%" />
          </Card>
        ) : profile.isError ? (
          <ErrorState onRetry={() => profile.refetch()} message={t("common.error")} />
        ) : (
          <FadeInView>
          <View
            style={[{
              backgroundColor: "#0A1230",
              borderRadius: 24,
              padding: 22,
              alignItems: "center",
              gap: 10,
              overflow: "hidden",
            }, softShadow(c.shadow)]}
          >
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                backgroundColor: c.primary,
                opacity: 0.9,
              }}
            />
            <Pressable onPress={changePhoto} style={{ alignItems: "center" }}>
              <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" }}>
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={{ width: 88, height: 88, borderRadius: 44 }}
                />
              ) : (
                <View
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: 44,
                    backgroundColor: "#141D45",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#EEF1FA", fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 28 }}>
                    {user?.initials ?? name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              )}
              </View>
              <View
                style={{
                  position: "absolute",
                  bottom: 0,
                  right: 0,
                  backgroundColor: c.primary,
                  borderRadius: 14,
                  width: 28,
                  height: 28,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 2,
                  borderColor: "#0A1230",
                }}
              >
                {uploadPhoto.isPending ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Feather name="camera" size={14} color="#FFFFFF" />
                )}
              </View>
            </Pressable>
            <Text style={{ color: "#EEF1FA", fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 21, letterSpacing: -0.3 }}>
              {name}
            </Text>
            {title ? (
              <Text style={{ color: "#9AA5C4", fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 14 }}>
                {title}
              </Text>
            ) : null}
            {email ? (
              <Text style={{ color: "#9AA5C4", fontFamily: "PlusJakartaSans_400Regular", fontSize: 13 }}>
                {email}
              </Text>
            ) : null}
            <View style={{ height: 6 }} />
            {/* Inline QR — scannable right from the page; tap to enlarge. */}
            <PressScale onPress={() => setQrOpen(true)}>
              <View
                style={{
                  backgroundColor: "#FFFFFF",
                  borderRadius: 18,
                  padding: 12,
                  alignItems: "center",
                }}
              >
                <QRCode
                  value={card || "BEGIN:VCARD\nEND:VCARD"}
                  size={124}
                  backgroundColor="#FFFFFF"
                  color="#0A1230"
                />
              </View>
            </PressScale>
          </View>
          </FadeInView>
        )}

        <View
          style={{
            flexDirection: rtl.row,
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 4,
          }}
        >
          <Text
            style={{
              color: c.foreground,
              fontFamily: "PlusJakartaSans_800ExtraBold",
              fontSize: 17,
              letterSpacing: -0.2,
              textAlign: rtl.textAlign,
            }}
          >
            {t("me.documents")}
          </Text>
          <PressScale onPress={() => setAddOpen(true)}>
            <View
              style={{
                flexDirection: rtl.row,
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 999,
                backgroundColor: c.tint08,
                borderWidth: 1,
                borderColor: c.tint25,
              }}
            >
              <Feather name="plus" size={14} color={c.primary} />
              <Text style={{ color: c.primary, fontFamily: "PlusJakartaSans_700Bold", fontSize: 13 }}>
                {t("me.addDocument")}
              </Text>
            </View>
          </PressScale>
        </View>

        {docs.isLoading ? (
          <View style={{ gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <Card key={i}>
                <Skeleton height={16} width="60%" />
              </Card>
            ))}
          </View>
        ) : docs.isError ? (
          <ErrorState onRetry={() => docs.refetch()} message={t("common.error")} />
        ) : documents.length === 0 ? (
          <EmptyState icon="folder" title={t("me.noDocuments")} body={t("me.noDocumentsBody")} />
        ) : (
          <View style={{ gap: 12 }}>
            {documents.map((doc) => (
              <Pressable
                key={doc.id}
                onPress={() => openDocument(doc, doc.hasBackFile ? "all" : "front")}
                disabled={!doc.hasFile}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <Card style={{ flexDirection: rtl.row, alignItems: "center", gap: 12 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 14,
                      backgroundColor: c.tint08,
                      borderWidth: 1,
                      borderColor: c.tint25,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Feather name={docIcon(doc.kind)} size={20} color={c.primary} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: c.foreground, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 15, textAlign: rtl.textAlign }}
                    >
                      {doc.title}
                    </Text>
                    {typeof doc.daysToExpiry === "number" ? (
                      <Chip
                        label={doc.daysToExpiry < 0 ? t("me.expired") : t("me.expires", { n: doc.daysToExpiry })}
                        color={doc.daysToExpiry < 30 ? c.destructive : c.mutedForeground}
                      />
                    ) : null}
                  </View>
                  {downloadingId === `${doc.id}:front` || replacingId === doc.id ? (
                    <ActivityIndicator size="small" color={c.primary} />
                  ) : doc.hasFile ? (
                    <Feather name={Platform.OS === "web" ? "external-link" : "download"} size={18} color={c.mutedForeground} />
                  ) : null}
                  <Pressable
                    hitSlop={8}
                    onPress={(e) => {
                      e.stopPropagation();
                      setDocActionsFor(doc);
                    }}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}
                  >
                    <Feather name="more-vertical" size={18} color={c.mutedForeground} />
                  </Pressable>
                </Card>
                {doc.kind === "national_id" && doc.sides === "front_only" ? (
                  <View style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text
                      style={{
                        color: c.destructive,
                        fontFamily: "PlusJakartaSans_500Medium",
                        fontSize: 12,
                        textAlign: rtl.textAlign,
                      }}
                    >
                      {t("me.idBackMissing")}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}

        {/* Task #1002 — personal tasks & reminders. */}
        <MyTasksSection />

        {/* Task #850 — official letters: history + re-download + request. */}
        <LettersSection />

        <SelfBillingSection />
      </ScrollView>

      <Modal visible={qrOpen} animationType="slide" transparent onRequestClose={() => setQrOpen(false)}>
        <Pressable
          onPress={() => setQrOpen(false)}
          style={{ flex: 1, backgroundColor: c.scrim, justifyContent: "center", padding: 32 }}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={[{ backgroundColor: c.card, borderRadius: 28, padding: 24, alignItems: "center", gap: 14, overflow: "hidden" }, softShadow(c.shadow)]}>
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 4,
                  backgroundColor: c.primary,
                }}
              />
              <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_700Bold", fontSize: 18 }}>
                {t("me.qrTitle")}
              </Text>
              {/* QR keeps a white surround for reliable scanning in both themes. */}
              <View style={{ padding: 12, backgroundColor: "#FFFFFF", borderRadius: 16 }}>
                <QRCode value={card || "BEGIN:VCARD\nEND:VCARD"} size={220} backgroundColor="#FFFFFF" color="#0A1230" />
              </View>
              <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 16 }}>{name}</Text>
              {title ? (
                <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 13 }}>{title}</Text>
              ) : null}
              <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 12 }}>
                {t("me.qrHint")}
              </Text>
              <Button label={t("common.close")} variant="secondary" onPress={() => setQrOpen(false)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Task #797 — per-document actions (replace scan / back side). */}
      <Sheet
        visible={!!docActionsFor}
        title={docActionsFor?.title ?? undefined}
        cancelLabel={t("common.cancel")}
        onClose={() => setDocActionsFor(null)}
        options={
          docActionsFor
            ? [
                {
                  label: docActionsFor.hasFile ? t("me.replaceScan") : t("me.attachScan"),
                  icon: "upload" as const,
                  defer: true,
                  onPress: () => {
                    openScanSheet({ kind: "replace", docId: docActionsFor.id, side: "front" });
                  },
                },
                ...(docActionsFor.kind === "national_id"
                  ? [
                      {
                        label: docActionsFor.hasBackFile ? t("me.replaceBack") : t("me.addBack"),
                        icon: "rotate-cw" as const,
                        defer: true,
                        onPress: () => {
                          openScanSheet({ kind: "replace", docId: docActionsFor.id, side: "back" });
                        },
                      },
                    ]
                  : []),
              ]
            : []
        }
      />

      {/* Task #797 — scan source (camera / gallery / file). */}
      <Sheet
        visible={scanSheetOpen}
        title={t("me.scanSource")}
        cancelLabel={t("common.cancel")}
        onClose={() => setScanSheetOpen(false)}
        onOptionSelected={() => setPickerActive(true)}
        options={[
          { label: t("exp.takePhoto"), icon: "camera", defer: true, onPress: () => void pickScanFrom("camera") },
          { label: t("exp.gallery"), icon: "image", defer: true, onPress: () => void pickScanFrom("library") },
          { label: t("me.pickFile"), icon: "file", defer: true, onPress: () => void pickScanFrom("file") },
        ]}
      />

      {/* Task #797 — add-document form. */}
      <Modal
        visible={addOpen && !scanSheetOpen && !pickerActive}
        animationType="slide"
        transparent
        onRequestClose={() => setAddOpen(false)}
      >
        <Pressable
          onPress={() => setAddOpen(false)}
          style={{ flex: 1, backgroundColor: c.scrim, justifyContent: "center", padding: 24 }}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={[{ backgroundColor: c.card, borderRadius: 24, padding: 20, gap: 12 }, softShadow(c.shadow)]}>
              <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_700Bold", fontSize: 16, textAlign: rtl.textAlign }}>
                {t("me.addDocument")}
              </Text>
              <View style={{ flexDirection: rtl.row, flexWrap: "wrap", gap: 8 }}>
                {DOC_KINDS.map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => {
                      setAddKind(k);
                      if (k !== "national_id") setAddBack(null);
                    }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: 999,
                      backgroundColor: addKind === k ? c.primary : c.tint08,
                      borderWidth: 1,
                      borderColor: addKind === k ? c.primary : c.tint25,
                    }}
                  >
                    <Text
                      style={{
                        color: addKind === k ? "#FFFFFF" : c.foreground,
                        fontFamily: "PlusJakartaSans_600SemiBold",
                        fontSize: 12,
                      }}
                    >
                      {t(`me.docKind.${k}`)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={addTitle}
                onChangeText={setAddTitle}
                placeholder={t("me.docTitle")}
                placeholderTextColor={c.mutedForeground}
                maxLength={200}
                style={{
                  borderWidth: 1,
                  borderColor: c.tint25,
                  borderRadius: 14,
                  padding: 12,
                  color: c.foreground,
                  fontFamily: "PlusJakartaSans_400Regular",
                  fontSize: 14,
                }}
              />
              <TextInput
                value={addExpires}
                onChangeText={setAddExpires}
                placeholder={t("me.docExpires")}
                placeholderTextColor={c.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  borderWidth: 1,
                  borderColor: c.tint25,
                  borderRadius: 14,
                  padding: 12,
                  color: c.foreground,
                  fontFamily: "PlusJakartaSans_400Regular",
                  fontSize: 14,
                }}
              />
              <Pressable
                onPress={() => openScanSheet({ kind: "add", slot: "front" })}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.7 : 1,
                  flexDirection: rtl.row,
                  alignItems: "center",
                  gap: 8,
                  borderWidth: 1,
                  borderStyle: "dashed" as const,
                  borderColor: c.tint25,
                  borderRadius: 14,
                  padding: 12,
                })}
              >
                <Feather name={addFront ? "check-circle" : "upload"} size={16} color={addFront ? "#2E9E62" : c.primary} />
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, color: addFront ? c.foreground : c.mutedForeground, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13, textAlign: rtl.textAlign }}
                >
                  {addFront ? addFront.name : t("me.docFront")}
                </Text>
              </Pressable>
              {addKind === "national_id" ? (
                <>
                  <Pressable
                    onPress={() => openScanSheet({ kind: "add", slot: "back" })}
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.7 : 1,
                      flexDirection: rtl.row,
                      alignItems: "center",
                      gap: 8,
                      borderWidth: 1,
                      borderStyle: "dashed" as const,
                      borderColor: c.tint25,
                      borderRadius: 14,
                      padding: 12,
                    })}
                  >
                    <Feather name={addBack ? "check-circle" : "rotate-cw"} size={16} color={addBack ? "#2E9E62" : c.primary} />
                    <Text
                      numberOfLines={1}
                      style={{ flex: 1, color: addBack ? c.foreground : c.mutedForeground, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13, textAlign: rtl.textAlign }}
                    >
                      {addBack ? addBack.name : t("me.docBack")}
                    </Text>
                  </Pressable>
                  <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 12, textAlign: rtl.textAlign }}>
                    {t("me.docCombinedHint")}
                  </Text>
                </>
              ) : null}
              <View style={{ flexDirection: rtl.row, gap: 10, justifyContent: "flex-end" }}>
                <Button
                  label={t("common.cancel")}
                  variant="secondary"
                  onPress={() => setAddOpen(false)}
                />
                <Button
                  label={createDoc.isPending ? t("me.docSaving") : t("me.docSave")}
                  onPress={() => void submitAdd()}
                  disabled={createDoc.isPending}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
