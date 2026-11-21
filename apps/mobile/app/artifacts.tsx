import type {
  ArtifactCategory,
  ArtifactCategoryMapping,
  ArtifactSoftwareKind,
} from "@rakazo_mickvvw/core";
import { artifactTypeLabel, DEFAULT_ARTIFACT_CATEGORY_MAPPING } from "@rakazo_mickvvw/core";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BotAvatar } from "../components/bot-avatar";
import { NativeSegmentedControl } from "../components/native-segmented-control";
import { NativeSymbol } from "../components/native-symbol";
import { formatActivityRelativeTime } from "../lib/activity";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import type { MobileArtifactSummary } from "../lib/artifacts";
import {
  listSpaceArtifacts,
  matchesArtifactCategory,
  matchesArtifactQuery,
  removeArtifact,
} from "../lib/artifacts";
import { useI18n } from "../lib/i18n";
import { getMiscSettings } from "../lib/misc-settings";
import type { MobileBot } from "../lib/mobile-types";
import { native, useMobileTokens, useThemedStyles } from "../lib/native";
import { useSideInsets } from "../lib/side-insets";
import { errorText } from "../lib/user-error";

const PAGE_SIZE = 30;

type CategoryIcon = Pick<Parameters<typeof NativeSymbol>[0], "ios" | "android">;

const CATEGORY_ICONS: Record<Exclude<ArtifactCategory, "other">, CategoryIcon> = {
  image: { ios: "photo", android: "image-outline" },
  video: { ios: "video", android: "videocam-outline" },
  archive: { ios: "archivebox", android: "archive-outline" },
  script: { ios: "chevron.left.forwardslash.chevron.right", android: "code-slash-outline" },
  document: { ios: "doc.text", android: "document-text-outline" },
  software: { ios: "square.grid.2x2", android: "apps-outline" },
};

const SOFTWARE_ICONS: Record<ArtifactSoftwareKind, CategoryIcon> = {
  desktop: { ios: "desktopcomputer", android: "desktop-outline" },
  apple: { ios: "apple.logo", android: "logo-apple" },
  android: { ios: "phone", android: "logo-android" },
  other: { ios: "cube", android: "cube-outline" },
};

export default function ArtifactsScreen() {
  const sideInsets = useSideInsets();
  const navigation = useNavigation();
  const router = useRouter();
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const tokens = useMobileTokens();
  const insets = useSafeAreaInsets();

  const [bots, setBots] = useState<MobileBot[]>([]);
  const { botId } = useLocalSearchParams<{ botId?: string }>();
  const [activeBotId, setActiveBotId] = useState<string | null>(botId || null);
  const [madeByBots, setMadeByBots] = useState(false);
  const [category, setCategory] = useState<ArtifactCategory | "all">("all");
  const [softwareKind, setSoftwareKind] = useState<ArtifactSoftwareKind | "all">("all");
  const [mapping, setMapping] = useState<ArtifactCategoryMapping>(
    DEFAULT_ARTIFACT_CATEGORY_MAPPING,
  );
  const chipsScrollRef = useRef<ScrollView>(null);
  const initialChipLayout = useRef({
    viewportWidth: 0,
    contentWidth: 0,
    chip: null as { x: number; width: number } | null,
    revealed: false,
  });

  function revealInitialChip() {
    const layout = initialChipLayout.current;
    if (layout.revealed || !layout.viewportWidth || !layout.chip) return;
    const right = layout.chip.x + layout.chip.width;
    if (layout.contentWidth < right) return;
    chipsScrollRef.current?.scrollTo({
      x: Math.max(0, right - layout.viewportWidth),
      animated: false,
    });
    layout.revealed = true;
  }

  const [items, setItems] = useState<MobileArtifactSummary[] | null>(null);
  const [next, setNext] = useState<{
    cursor: string;
    botId: string | null;
    madeByBots: boolean;
  } | null>(null);
  const nextCursor =
    next?.botId === activeBotId && next.madeByBots === madeByBots ? next.cursor : null;
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchPageFailed, setSearchPageFailed] = useState(false);
  const loadingMoreRef = useRef(false);
  const generationRef = useRef(0);
  const autoFetchedCursorRef = useRef<string | null>(null);
  const activeBotIdRef = useRef(activeBotId);
  const madeByBotsRef = useRef(madeByBots);
  const didFocusRef = useRef(false);
  activeBotIdRef.current = activeBotId;
  madeByBotsRef.current = madeByBots;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerSearchBarOptions: {
        placeholder: t("Search artifacts…"),
        hideWhenScrolling: false,
        autoCapitalize: "none",
        onChangeText: (event: { nativeEvent: { text: string } }) =>
          setQuery(event.nativeEvent.text),
        onCancelButtonPress: () => setQuery(""),
        onClose: () => setQuery(""),
      },
    });
  }, [navigation, t]);

  useFocusEffect(
    useCallback(() => {
      rpc("bots/list")
        .then(setBots)
        .catch(() => undefined);
      getMiscSettings()
        .then((settings) => setMapping(settings.categories))
        .catch(() => undefined);
    }, []),
  );

  const load = useCallback(
    async (botId: string | null, madeByBots: boolean, mode: "replace" | "refresh") => {
      const generation = ++generationRef.current;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      autoFetchedCursorRef.current = null;
      setSearchPageFailed(false);
      setLoadError(null);
      if (mode === "replace") {
        setItems(null);
        setNext(null);
      }
      try {
        const page = await listSpaceArtifacts({
          botId: botId ?? undefined,
          madeByBots,
          limit: PAGE_SIZE,
        });
        if (generation !== generationRef.current) return;
        setItems(page.items);
        setNext(page.nextCursor ? { cursor: page.nextCursor, botId, madeByBots } : null);
      } catch (error) {
        if (generation !== generationRef.current) return;
        if (mode === "replace") {
          setLoadError(errorText(error, t("Could not load artifacts.")));
        }
      }
    },
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      if (!didFocusRef.current) {
        didFocusRef.current = true;
        return;
      }
      void load(activeBotIdRef.current, madeByBotsRef.current, "refresh");
    }, [load]),
  );

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current) return;
    const generation = generationRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await listSpaceArtifacts({
        botId: activeBotId ?? undefined,
        madeByBots,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
      if (generation !== generationRef.current) return;
      setItems((current) => (current ?? []).concat(page.items));
      setNext(page.nextCursor ? { cursor: page.nextCursor, botId: activeBotId, madeByBots } : null);
      setSearchPageFailed(false);
    } catch {
      if (generation === generationRef.current) setSearchPageFailed(true);
    } finally {
      if (generation === generationRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [activeBotId, madeByBots, nextCursor]);

  async function refresh() {
    setRefreshing(true);
    try {
      await load(activeBotId, madeByBots, "refresh");
    } finally {
      setRefreshing(false);
    }
  }

  function confirmDelete(item: MobileArtifactSummary) {
    Alert.alert(
      t('Delete "{name}"?', { name: item.name }),
      item.versionCount > 1
        ? t("This deletes all {count} versions of this artifact. This can't be undone.", {
            count: item.versionCount,
          })
        : t("This can't be undone."),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Delete"),
          style: "destructive",
          onPress: () =>
            void removeArtifact(item.id)
              .then(() =>
                setItems((current) => current?.filter((row) => row.id !== item.id) ?? current),
              )
              .catch((error: unknown) =>
                Alert.alert(t("Could not delete this artifact"), errorText(error, t("Try again."))),
              ),
        },
      ],
    );
  }

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const downloadItem = useCallback(async (item: MobileArtifactSummary) => {
    setDownloadingId(item.id);
    try {
      // Loaded on tap, not at screen mount: artifact-open pulls in the
      // native file-system modules, which the bot-profile tests do not mock.
      const { downloadMobileArtifact } = await import("../lib/artifact-open");
      const saved = await downloadMobileArtifact(item.id);
      if (!saved) return;
      Alert.alert(t("Saved {name} locally", { name: saved.name }));
    } catch {
      Alert.alert(t("Could not save {name}. Try again.", { name: item.name }));
    } finally {
      setDownloadingId((current) => (current === item.id ? null : current));
    }
  }, []);

  const queryActive = query.trim().length > 0;
  const categoryActive = category !== "all";
  const filterActive = queryActive || categoryActive;
  const filtered = useMemo(() => {
    if (!items) return null;
    return items.filter(
      (item) =>
        matchesArtifactQuery(item, query) &&
        matchesArtifactCategory(item, category, softwareKind, mapping),
    );
  }, [items, query, category, softwareKind, mapping]);
  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);

  useEffect(() => {
    autoFetchedCursorRef.current = null;
    setSearchPageFailed(false);
  }, [query, activeBotId, madeByBots, category, softwareKind]);

  useEffect(() => {
    if (searchPageFailed || !filterActive || !nextCursor || loadingMore || items === null) return;
    if (filtered && filtered.length > 0) return;
    if (autoFetchedCursorRef.current === nextCursor) return;
    autoFetchedCursorRef.current = nextCursor;
    void loadMore();
  }, [filtered, items, loadMore, loadingMore, nextCursor, filterActive, searchPageFailed]);

  useEffect(() => {
    void load(activeBotId, madeByBots, "replace");
  }, [activeBotId, madeByBots, load]);

  const categoryOptions: { key: Exclude<ArtifactCategory, "other"> | "all"; label: string }[] = [
    { key: "all", label: t("All") },
    { key: "image", label: t("Images") },
    { key: "video", label: t("Film and video") },
    { key: "archive", label: t("Archives") },
    { key: "script", label: t("Scripts") },
    { key: "document", label: t("Documents") },
    { key: "software", label: t("Software") },
  ];
  const softwareOptions: { key: ArtifactSoftwareKind | "all"; label: string }[] = [
    { key: "all", label: t("All software") },
    { key: "desktop", label: t("Desktop software") },
    { key: "apple", label: t("Apple software") },
    { key: "android", label: t("Android software") },
    { key: "other", label: t("Other software") },
  ];

  function categoryAvatar(icon: CategoryIcon, active: boolean) {
    return (
      <NativeSymbol
        ios={icon.ios}
        android={icon.android}
        size={13}
        color={active ? tokens.primaryForeground : native.label}
      />
    );
  }

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <FlatList<MobileArtifactSummary>
        ListHeaderComponent={
          <View>
            <View style={styles.sourceControl}>
              <NativeSegmentedControl
                accessibilityLabel={t("Filter by who made it")}
                value={madeByBots ? "bots" : "all"}
                onChange={(value) => setMadeByBots(value === "bots")}
                options={[
                  { value: "all" as const, label: t("All files") },
                  { value: "bots" as const, label: t("Made by bots") },
                ]}
              />
            </View>
            <ScrollView
              ref={chipsScrollRef}
              onLayout={(event) => {
                initialChipLayout.current.viewportWidth = event.nativeEvent.layout.width;
                revealInitialChip();
              }}
              onContentSizeChange={(width) => {
                initialChipLayout.current.contentWidth = width;
                revealInitialChip();
              }}
              horizontal
              contentInsetAdjustmentBehavior="never"
              showsHorizontalScrollIndicator={false}
              style={styles.chipsScroll}
              contentContainerStyle={styles.chipsRow}
            >
              <Chip
                label={t("All bots")}
                active={activeBotId === null}
                onPress={() => setActiveBotId(null)}
              />
              {bots.map((bot) => (
                <Chip
                  key={bot.id}
                  onLayout={
                    bot.id === botId && activeBotId === botId
                      ? (event) => {
                          initialChipLayout.current.chip = event.nativeEvent.layout;
                          revealInitialChip();
                        }
                      : undefined
                  }
                  label={bot.name}
                  active={activeBotId === bot.id}
                  onPress={() => setActiveBotId(bot.id)}
                  avatar={
                    <BotAvatar
                      color={bot.color}
                      avatarSet={bot.avatarSet}
                      identity={bot.id}
                      size={16}
                    />
                  }
                />
              ))}
            </ScrollView>
            <ScrollView
              horizontal
              contentInsetAdjustmentBehavior="never"
              showsHorizontalScrollIndicator={false}
              style={styles.chipsScroll}
              contentContainerStyle={styles.chipsRow}
            >
              {categoryOptions.map((option) => {
                const active = category === option.key;
                return (
                  <Chip
                    key={option.key}
                    label={option.label}
                    active={active}
                    onPress={() => {
                      setCategory(option.key);
                      setSoftwareKind("all");
                    }}
                    avatar={
                      option.key === "all"
                        ? undefined
                        : categoryAvatar(CATEGORY_ICONS[option.key], active)
                    }
                  />
                );
              })}
            </ScrollView>
            {category === "software" ? (
              <ScrollView
                horizontal
                contentInsetAdjustmentBehavior="never"
                showsHorizontalScrollIndicator={false}
                style={styles.chipsScroll}
                contentContainerStyle={styles.chipsRow}
              >
                {softwareOptions.map((option) => {
                  const active = softwareKind === option.key;
                  return (
                    <Chip
                      key={option.key}
                      label={option.label}
                      active={active}
                      onPress={() => setSoftwareKind(option.key)}
                      avatar={
                        option.key === "all"
                          ? undefined
                          : categoryAvatar(SOFTWARE_ICONS[option.key], active)
                      }
                    />
                  );
                })}
              </ScrollView>
            ) : null}
          </View>
        }
        style={[styles.listView, sideInsets]}
        contentInsetAdjustmentBehavior="automatic"
        data={filtered ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        indicatorStyle="default"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={native.secondaryLabel}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadMore()}
        ListEmptyComponent={
          items === null ? (
            <View style={styles.centered}>
              {loadError ? (
                <Text style={styles.empty}>{loadError}</Text>
              ) : (
                <ActivityIndicator color={native.secondaryLabel} />
              )}
            </View>
          ) : filterActive && filtered?.length === 0 && nextCursor && searchPageFailed ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                autoFetchedCursorRef.current = null;
                setSearchPageFailed(false);
              }}
              style={styles.centered}
            >
              <Text style={styles.empty}>{t("Could not load artifacts.")}</Text>
              <Text style={styles.empty}>{t("Try again.")}</Text>
            </Pressable>
          ) : filterActive &&
            filtered?.length === 0 &&
            nextCursor &&
            (loadingMore || autoFetchedCursorRef.current !== nextCursor) ? (
            <View style={styles.centered}>
              <ActivityIndicator color={native.secondaryLabel} />
            </View>
          ) : (
            <Text style={styles.empty}>
              {filterActive || madeByBots ? t("No matching artifacts") : t("No artifacts yet")}
            </Text>
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={native.secondaryLabel} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ArtifactRow
            item={item}
            bot={activeBotId === null && item.botId ? botsById.get(item.botId) : undefined}
            onPress={() => router.push({ pathname: "/artifact", params: { artifactId: item.id } })}
            onLongPress={() => confirmDelete(item)}
            onDownload={() => void downloadItem(item)}
            downloading={downloadingId === item.id}
          />
        )}
      />
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  avatar,
  onLayout,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  avatar?: ReactNode;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onLayout={onLayout}
      style={[styles.chip, active && styles.chipActive]}
    >
      {avatar}
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ArtifactRow({
  item,
  bot,
  onPress,
  onLongPress,
  onDownload,
  downloading,
}: {
  item: MobileArtifactSummary;
  bot?: MobileBot;
  onPress: () => void;
  onLongPress: () => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const { t } = useI18n();
  const isCode = item.mimeType === "text/html";
  return (
    <View style={styles.rowWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bot ? `${item.name}, ${bot.name}` : item.name}
        accessibilityHint={t("Long press to delete")}
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={styles.rowIcon}>
          <NativeSymbol
            ios={isCode ? "chevron.left.forwardslash.chevron.right" : "doc.text"}
            android={isCode ? "code-slash-outline" : "document-text-outline"}
            size={16}
          />
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={styles.rowName} numberOfLines={1}>
              {item.name}
            </Text>
            {item.versionCount > 1 ? <Text style={styles.badge}>{`v${item.version}`}</Text> : null}
            <Text style={styles.badge}>{artifactTypeLabel(item.mimeType)}</Text>
          </View>
          {item.description ? (
            <Text style={styles.rowDescription} numberOfLines={1}>
              {item.description}
            </Text>
          ) : null}
          <View style={styles.rowFooter}>
            {bot ? (
              <>
                <BotAvatar
                  color={bot.color}
                  avatarSet={bot.avatarSet}
                  identity={bot.id}
                  size={14}
                />
                <Text style={styles.rowBotName} numberOfLines={1}>
                  {bot.name}
                </Text>
              </>
            ) : null}
            <Text style={styles.rowMeta}>{formatActivityRelativeTime(item.createdAt)}</Text>
          </View>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("Download")}
        disabled={downloading}
        onPress={onDownload}
        hitSlop={8}
        style={styles.rowDownload}
      >
        <NativeSymbol ios="square.and.arrow.down" android="download-outline" size={19} />
      </Pressable>
    </View>
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.page },
    centered: { alignItems: "center", justifyContent: "center", paddingTop: 40 },
    sourceControl: { paddingHorizontal: 16, paddingTop: 10 },
    chipsScroll: { flexGrow: 0, flexShrink: 0 },
    chipsRow: {
      flexDirection: "row",
      alignItems: "center",
      flexGrow: 0,
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      flexGrow: 0,
      flexShrink: 0,
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: native.fill,
    },
    chipActive: { backgroundColor: tokens.primary },
    chipLabel: { color: native.label, fontSize: 13, fontWeight: "600" },
    chipLabelActive: { color: tokens.primaryForeground },
    listView: { flex: 1 },
    list: { paddingBottom: 32 },
    empty: {
      color: native.secondaryLabel,
      fontSize: 15,
      textAlign: "center",
      paddingHorizontal: 24,
      paddingTop: 8,
    },
    footer: { paddingVertical: 20 },
    rowWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    row: { flex: 1, flexDirection: "row", gap: 12, minWidth: 0 },
    rowPressed: { opacity: 0.6 },
    rowDownload: { padding: 8 },
    rowIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: native.fill,
      alignItems: "center",
      justifyContent: "center",
    },
    rowBody: { flex: 1, minWidth: 0, gap: 3 },
    rowTop: { flexDirection: "row", alignItems: "center", gap: 6 },
    rowName: { flex: 1, minWidth: 0, color: native.label, fontSize: 15, fontWeight: "600" },
    badge: {
      color: native.secondaryLabel,
      fontSize: 10.5,
      fontWeight: "700",
      backgroundColor: native.fill,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
      overflow: "hidden",
    },
    rowDescription: { color: native.secondaryLabel, fontSize: 12.5 },
    rowFooter: { flexDirection: "row", alignItems: "center", gap: 6 },
    rowBotName: { flexShrink: 1, color: native.secondaryLabel, fontSize: 11.5 },
    rowMeta: { color: native.secondaryLabel, fontSize: 11.5 },
  });
}
