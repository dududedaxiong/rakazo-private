import type { ConversationShareSummary } from "@rakazo_mickvvw/contracts";
import {
  parseCustomShareExpiryDays,
  SHARE_DEFAULT_EXPIRY_DAYS,
  SHARE_EXPIRY_DAYS,
} from "@rakazo_mickvvw/contracts";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Share, Text, TextInput, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import type { MobileArtifactTarget } from "../lib/artifact-open";
import { useI18n } from "../lib/i18n";
import { conversationShareExpiryLabel, conversationShareState } from "../lib/share-conversation";
import { shareLinkQrSvg } from "../lib/share-link-qr";
import { BottomSheetShell } from "./bottom-sheet-shell";

type ShareExpiry = number | null;

function expiryLabel(days: ShareExpiry, t: (id: string) => string): string {
  if (days === 1) return t("1 day");
  if (days === 7) return t("7 days");
  if (days === 30) return t("30 days");
  if (days === 365) return t("1 year");
  return t("Never");
}

/**
 * A conversation's replay links, like the web dialog: create one (30 days
 * by default), copy it or send it through the system share sheet, revoke it,
 * or restore it — restoring brings the same link back. A revoked link can
 * also be deleted, which removes it from the list for good. Tapping a row
 * shows that link's QR code, like the web dialog. The link opens a
 * read-only replay in the browser without signing in; the app itself never
 * renders the replay page.
 */
export function ShareConversationSheet({
  visible,
  onClose,
  target,
}: {
  visible: boolean;
  onClose: () => void;
  target: MobileArtifactTarget;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const [items, setItems] = useState<ConversationShareSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<ShareExpiry>(SHARE_DEFAULT_EXPIRY_DAYS);
  const [customDays, setCustomDays] = useState("");
  const [customSelected, setCustomSelected] = useState(false);
  const [newest, setNewest] = useState<ConversationShareSummary | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /** The list row whose QR code is open, if any; the code carries that row's link. */
  const [rowQr, setRowQr] = useState<{ id: string; svg: string | null } | null>(null);
  const targetKey = "botId" in target ? `bot:${target.botId}` : `group:${target.groupId}`;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setNewest(null);
    setRowQr(null);
    setCreateError(false);
    setLoadError(false);
    setLoading(true);
    rpc("shares/list", target)
      .then(({ items: listed }) => {
        if (!cancelled) setItems(listed);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // targetKey stands in for target: the sheet must not reload its list
    // when the screen hands it a fresh object for the same thread.
  }, [visible, targetKey]);

  async function create() {
    if (creating) return;
    const customDaysParsed = parseCustomShareExpiryDays(customDays);
    if (customSelected && customDaysParsed === null) return;
    setCreating(true);
    setCreateError(false);
    try {
      const share = await rpc("shares/create", {
        ...target,
        expiresInDays: customSelected ? customDaysParsed : expiresInDays,
      });
      setNewest(share);
      setItems((current) => [share, ...current.filter((item) => item.id !== share.id)]);
    } catch {
      setCreateError(true);
    } finally {
      setCreating(false);
    }
  }

  async function toggle(item: ConversationShareSummary) {
    if (busyId) return;
    const restoreIt = conversationShareState(item) !== "live";
    setBusyId(item.id);
    try {
      const updated = await rpc(restoreIt ? "shares/restore" : "shares/revoke", {
        shareId: item.id,
      });
      setItems((current) => current.map((entry) => (entry.id === item.id ? updated : entry)));
      if (newest?.id === item.id) setNewest(updated);
    } catch {
      Alert.alert(t("Could not update the link"), t("Try again."));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: ConversationShareSummary) {
    if (busyId) return;
    setBusyId(item.id);
    try {
      await rpc("shares/delete", { shareId: item.id });
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      if (newest?.id === item.id) setNewest(null);
      if (rowQr?.id === item.id) setRowQr(null);
    } catch {
      Alert.alert(t("Could not delete the link"), t("Try again."));
    } finally {
      setBusyId(null);
    }
  }

  function toggleRowQr(item: ConversationShareSummary) {
    if (!item.shareUrl) return;
    if (rowQr?.id === item.id) {
      setRowQr(null);
      return;
    }
    const { id, shareUrl } = item;
    setRowQr({ id, svg: null });
    void shareLinkQrSvg(shareUrl)
      .then((svg) => {
        setRowQr((current) => (current?.id === id ? { id, svg } : current));
      })
      .catch(() => null);
  }

  async function copyLink(item: ConversationShareSummary) {
    if (!item.shareUrl) return;
    // Loaded on demand, like the other Expo modules in this app: the sheet's
    // static import graph stays free of the native clipboard module, which
    // reads __DEV__ at import time and breaks tests that import this screen.
    const Clipboard = await import("expo-clipboard").catch(() => null);
    if (!Clipboard) return;
    const copied = await Clipboard.setStringAsync(item.shareUrl)
      .then(() => true)
      .catch(() => false);
    if (!copied) return;
    setCopiedId(item.id);
    setTimeout(() => {
      setCopiedId((current) => (current === item.id ? null : current));
    }, 2000);
  }

  async function shareLink(item: ConversationShareSummary) {
    if (!item.shareUrl) return;
    await Share.share({ message: item.shareUrl });
  }

  function stateLabel(item: ConversationShareSummary): string {
    const state = conversationShareState(item);
    if (state === "revoked") return t("Revoked");
    if (state === "expired") return t("Expired");
    if (item.expiresAt)
      return t("Expires {date}", { date: conversationShareExpiryLabel(item.expiresAt) });
    return t("Never expires");
  }

  return (
    <BottomSheetShell visible={visible} label={t("Share conversation")} onClose={onClose}>
      <Text style={{ color: tokens.mutedForeground, fontSize: 15 }}>
        {t(
          "The link opens a read-only replay without signing in. Secrets and local paths are removed before sharing.",
        )}
      </Text>
      <Text style={{ color: tokens.foreground, fontSize: 15, marginTop: 16 }}>
        {t("Link expires in")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {[...SHARE_EXPIRY_DAYS, null].map((days) => {
          const selected = expiresInDays === days && !customSelected;
          return (
            <Pressable
              key={days ?? "never"}
              onPress={() => {
                setExpiresInDays(days);
                setCustomSelected(false);
              }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: selected ? tokens.accent : tokens.muted,
              }}
            >
              <Text
                style={{
                  color: selected ? tokens.accentForeground : tokens.foreground,
                  fontSize: 15,
                }}
              >
                {expiryLabel(days, t)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setCustomSelected(true)}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor: customSelected ? tokens.accent : tokens.muted,
          }}
        >
          <Text
            style={{
              color: customSelected ? tokens.accentForeground : tokens.foreground,
              fontSize: 15,
            }}
          >
            {t("Custom")}
          </Text>
        </Pressable>
      </View>
      {customSelected ? (
        <TextInput
          keyboardType="number-pad"
          value={customDays}
          onChangeText={setCustomDays}
          placeholder={t("Days")}
          accessibilityLabel={t("Custom expiry in days")}
          style={{
            marginTop: 8,
            width: 96,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: 8,
            color: tokens.foreground,
            fontSize: 15,
          }}
        />
      ) : null}
      <Pressable
        onPress={() => void create()}
        disabled={creating || (customSelected && parseCustomShareExpiryDays(customDays) === null)}
        style={{
          marginTop: 12,
          paddingVertical: 12,
          alignItems: "center",
          borderRadius: 8,
          backgroundColor: tokens.primary,
          opacity:
            creating || (customSelected && parseCustomShareExpiryDays(customDays) === null)
              ? 0.4
              : 1,
        }}
      >
        <Text style={{ color: tokens.primaryForeground, fontSize: 16 }}>{t("Create link")}</Text>
      </Pressable>
      {createError ? (
        <Text style={{ color: tokens.destructive, fontSize: 15, marginTop: 8 }}>
          {t("Could not create the link. Try again.")}
        </Text>
      ) : null}
      {newest?.shareUrl ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginTop: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderWidth: 1,
            borderColor: tokens.border,
            borderRadius: 8,
          }}
        >
          <Text style={{ flex: 1, color: tokens.foreground, fontSize: 15 }} numberOfLines={1}>
            {newest.shareUrl}
          </Text>
          <Pressable onPress={() => void copyLink(newest)}>
            <Text style={{ color: tokens.foreground, fontSize: 15 }}>
              {copiedId === newest.id ? t("Copied") : t("Copy")}
            </Text>
          </Pressable>
          <Pressable onPress={() => void shareLink(newest)}>
            <Text style={{ color: tokens.foreground, fontSize: 15 }}>{t("Share")}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={{ gap: 8, marginTop: 16 }}>
        {loading ? (
          <ActivityIndicator />
        ) : loadError ? (
          <Text style={{ color: tokens.destructive, fontSize: 15 }}>
            {t("Could not load the links. Try again.")}
          </Text>
        ) : items.length === 0 ? (
          <Text style={{ color: tokens.mutedForeground, fontSize: 15 }}>{t("No links yet.")}</Text>
        ) : (
          items.map((item) => {
            const live = conversationShareState(item) === "live";
            const expanded = rowQr?.id === item.id;
            return (
              <View key={item.id}>
                <Pressable
                  onPress={() => toggleRowQr(item)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderColor: tokens.border,
                    borderRadius: 8,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: tokens.foreground, fontSize: 15 }} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={{ color: tokens.mutedForeground, fontSize: 13 }} numberOfLines={1}>
                      {stateLabel(item)}
                      {` · ${item.createdAt.slice(0, 10)}`}
                    </Text>
                  </View>
                  {item.shareUrl ? (
                    <>
                      <Pressable onPress={() => void copyLink(item)}>
                        <Text style={{ color: tokens.foreground, fontSize: 15 }}>
                          {copiedId === item.id ? t("Copied") : t("Copy")}
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => void shareLink(item)}>
                        <Text style={{ color: tokens.foreground, fontSize: 15 }}>{t("Share")}</Text>
                      </Pressable>
                    </>
                  ) : null}
                  <Pressable
                    onPress={() => void toggle(item)}
                    disabled={busyId === item.id}
                    style={{ opacity: busyId === item.id ? 0.4 : 1 }}
                  >
                    <Text style={{ color: tokens.foreground, fontSize: 15 }}>
                      {live ? t("Revoke") : t("Restore")}
                    </Text>
                  </Pressable>
                  {conversationShareState(item) === "revoked" ? (
                    <Pressable
                      onPress={() =>
                        Alert.alert(t("Delete {name}?", { name: item.title }), undefined, [
                          { text: t("Cancel"), style: "cancel" },
                          {
                            text: t("Delete"),
                            style: "destructive",
                            onPress: () => void remove(item),
                          },
                        ])
                      }
                      disabled={busyId === item.id}
                      style={{ opacity: busyId === item.id ? 0.4 : 1 }}
                    >
                      <Text style={{ color: tokens.destructive, fontSize: 15 }}>{t("Delete")}</Text>
                    </Pressable>
                  ) : null}
                </Pressable>
                {expanded && rowQr?.svg ? (
                  <View style={{ marginTop: 8 }}>
                    <SvgXml xml={rowQr.svg} width={192} height={192} />
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>
    </BottomSheetShell>
  );
}
