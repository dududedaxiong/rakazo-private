import type { ZipFileEntry } from "@rakazo_mickvvw/core";
import { zipFiles } from "@rakazo_mickvvw/core";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeSegmentedControl } from "../components/native-segmented-control";
import { NativeSymbol } from "../components/native-symbol";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { base64ToBytes } from "../lib/artifact-file";
import { downloadMobileArtifact, imageArtifactUri } from "../lib/artifact-open";
import type { MobileArtifactSummary } from "../lib/artifacts";
import {
  artifactThreadTarget,
  getArtifactById,
  listSpaceArtifacts,
  removeArtifact,
} from "../lib/artifacts";
import type { GalleryCategory, GallerySort } from "../lib/gallery";
import {
  formatGalleryDayLabel,
  gallerySortLabelKey,
  galleryTileTime,
  galleryTotalBytes,
  galleryZipFileName,
  groupGalleryItemsByDay,
  isGallerySaveOverLimit,
  isGeneratedMedia,
  matchesGalleryCategory,
  nextGallerySort,
  toggleGallerySelection,
} from "../lib/gallery";
import { exportGalleryZip, GalleryExportError } from "../lib/gallery-export";
import { dateLocaleForUi, t, useI18n } from "../lib/i18n";
import { formatBytes } from "../lib/media-folders";
import { useMobileTokens, useThemedStyles } from "../lib/native";
import { useSideInsets } from "../lib/side-insets";
import type { UiLocale } from "../lib/ui-locale";
import { errorText } from "../lib/user-error";

const PAGE_SIZE = 30;

type GallerySection = { title: string | null; data: MobileArtifactSummary[][] };

function chunkRows(items: readonly MobileArtifactSummary[]): MobileArtifactSummary[][] {
  const rows: MobileArtifactSummary[][] = [];
  for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3));
  return rows;
}

export default function GalleryScreen() {
  const styles = useThemedStyles(makeStyles);
  const tokens = useMobileTokens();
  const insets = useSafeAreaInsets();
  const side = useSideInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { locale } = useI18n();
  const [category, setCategory] = useState<GalleryCategory>("all");
  const [sort, setSort] = useState<GallerySort>("date-desc");
  const [items, setItems] = useState<MobileArtifactSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<{ cursor: string; sort: GallerySort } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [botsById, setBotsById] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const autoFetchedCursorRef = useRef<string | null>(null);
  const didFocusRef = useRef(false);

  const load = useCallback(async (nextSort: GallerySort, mode: "replace" | "refresh") => {
    const generation = ++generationRef.current;
    if (mode === "replace") {
      setItems(null);
      setNextCursor(null);
      setLoadError(null);
    }
    try {
      const page = await listSpaceArtifacts({ madeByBots: true, sort: nextSort, limit: PAGE_SIZE });
      if (generationRef.current !== generation) return;
      setItems(page.items);
      setNextCursor(page.nextCursor ? { cursor: page.nextCursor, sort: nextSort } : null);
      setLoadError(null);
    } catch (error) {
      if (generationRef.current !== generation) return;
      setLoadError(errorText(error, t("Could not load gallery.")));
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !nextCursor || items === null) return;
    setLoadingMore(true);
    const pageSort = nextCursor.sort;
    const cursor = nextCursor.cursor;
    try {
      const page = await listSpaceArtifacts({
        madeByBots: true,
        sort: pageSort,
        limit: PAGE_SIZE,
        cursor,
      });
      setItems((current) => (current === null ? page.items : [...current, ...page.items]));
      setNextCursor(page.nextCursor ? { cursor: page.nextCursor, sort: pageSort } : null);
    } catch {
      // keep the loaded rows; a retry happens on scroll
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, items]);

  useEffect(() => {
    autoFetchedCursorRef.current = null;
    void load(sort, "replace");
  }, [category, sort, load]);

  useFocusEffect(
    useCallback(() => {
      if (didFocusRef.current) {
        void load(sort, "refresh");
      }
      didFocusRef.current = true;
      let cancelled = false;
      void rpc("bots/list")
        .then((bots) => {
          if (cancelled) return;
          setBotsById(Object.fromEntries(bots.map((bot) => [bot.id, bot.name])));
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [load, sort]),
  );

  useEffect(() => {
    navigation.setOptions({ title: t("Gallery") });
  }, [navigation]);

  const visible = useMemo(
    () =>
      items === null
        ? null
        : items.filter(
            (entry) => isGeneratedMedia(entry) && matchesGalleryCategory(entry, category),
          ),
    [items, category],
  );

  // The list is server-paged, but a page can hold only non-generated bot files;
  // keep paging while the filtered view is empty.
  useEffect(() => {
    if (!nextCursor || loadingMore || items === null || !visible || visible.length > 0) return;
    if (autoFetchedCursorRef.current === nextCursor.cursor) return;
    autoFetchedCursorRef.current = nextCursor.cursor;
    void loadMore();
  }, [visible, items, loadMore, loadingMore, nextCursor]);

  const dateMode = sort === "date-desc" || sort === "date-asc";
  const sections = useMemo<GallerySection[]>(() => {
    if (!visible) return [];
    if (!dateMode) return [{ title: null, data: chunkRows(visible) }];
    return groupGalleryItemsByDay(visible).map((group) => ({
      title: formatGalleryDayLabel(group, new Date(), dateLocaleForUi(locale), t),
      data: chunkRows(group.items),
    }));
  }, [visible, dateMode, locale]);

  const selectMode = selectedIds.size > 0;
  const selectedItems = useMemo(
    () => (items === null ? [] : items.filter((entry) => selectedIds.has(entry.id))),
    [items, selectedIds],
  );

  const changeCategory = useCallback((next: GalleryCategory) => {
    setSelectedIds(new Set());
    setCategory(next);
  }, []);

  const cycleSort = useCallback(() => {
    setSelectedIds(new Set());
    setSort((current) => nextGallerySort(current));
  }, []);

  const openItem = useCallback(
    (item: MobileArtifactSummary) => {
      if (selectMode) {
        setSelectedIds((current) => toggleGallerySelection(current, item.id));
        return;
      }
      router.push({ pathname: "/artifact", params: { artifactId: item.id } });
    },
    [router, selectMode],
  );

  const longPressItem = useCallback((item: MobileArtifactSummary) => {
    setSelectedIds((current) => toggleGallerySelection(current, item.id));
  }, []);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const downloadItem = useCallback(async (item: MobileArtifactSummary) => {
    setDownloadingId(item.id);
    try {
      const saved = await downloadMobileArtifact(item.id);
      if (!saved) return;
      Alert.alert(t("Saved {name} locally", { name: saved.name }));
    } catch {
      Alert.alert(t("Could not save {name}. Try again.", { name: item.name }));
    } finally {
      setDownloadingId((current) => (current === item.id ? null : current));
    }
  }, []);

  async function saveSelected() {
    if (selectedItems.length === 0 || saveBusy || deleteBusy) return;
    if (isGallerySaveOverLimit(galleryTotalBytes(selectedItems))) {
      setSaveError(t("Selected files are over 500 MB. Save them in smaller batches."));
      return;
    }
    setSaveBusy(true);
    setSaveError(null);
    try {
      const files: ZipFileEntry[] = [];
      let failedName: string | null = null;
      for (const entry of selectedItems) {
        try {
          const artifact = await getArtifactById(entry.id);
          files.push({ name: entry.name, data: base64ToBytes(artifact.contentBase64) });
        } catch {
          failedName = entry.name;
          break;
        }
      }
      if (failedName) {
        setSaveError(t("Could not save {name}. Try again.", { name: failedName }));
        return;
      }
      const fileName = galleryZipFileName(new Date());
      const result = await exportGalleryZip(zipFiles(files), fileName);
      if (result.kind === "saved") {
        Alert.alert(t("Saved {name} locally", { name: result.path }));
      } else {
        Alert.alert(t("Shared {name}", { name: result.fileName }));
      }
    } catch (error) {
      if (error instanceof GalleryExportError && error.code === "cancelled") return;
      setSaveError(errorText(error, t("Could not save the selected files. Try again.")));
    } finally {
      setSaveBusy(false);
    }
  }

  function askDelete() {
    if (selectedItems.length === 0 || deleteBusy) return;
    setDeleteError(null);
    Alert.alert(
      t("Delete {count} items?", { count: selectedItems.length }),
      t("Deleted files can't be recovered. Save them to your device first."),
      [
        { text: t("Cancel"), style: "cancel" },
        { text: t("Delete"), style: "destructive", onPress: () => void confirmDelete() },
      ],
    );
  }

  async function confirmDelete() {
    if (deleteBusy) return;
    const targets = selectedItems;
    setDeleteBusy(true);
    setDeleteError(null);
    const failed: MobileArtifactSummary[] = [];
    for (const entry of targets) {
      try {
        await removeArtifact(entry.id);
      } catch {
        failed.push(entry);
      }
    }
    const failedIds = new Set(failed.map((entry) => entry.id));
    const deletedIds = new Set(targets.map((entry) => entry.id).filter((id) => !failedIds.has(id)));
    if (deletedIds.size > 0) {
      setItems((current) =>
        current === null ? null : current.filter((row) => !deletedIds.has(row.id)),
      );
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of deletedIds) next.delete(id);
        return next;
      });
    }
    setDeleteBusy(false);
    if (failed.length > 0) {
      setDeleteError(
        t("Could not delete {names}. Try again.", {
          names: failed.map((entry) => entry.name).join("、"),
        }),
      );
    }
  }

  const emptyMessage =
    category === "image"
      ? t("No generated images yet")
      : category === "video"
        ? t("No generated videos yet")
        : t("No generated images or videos yet");

  return (
    <View style={[styles.root, { paddingBottom: selectMode ? insets.bottom : 0 }]}>
      <SectionList<MobileArtifactSummary[], GallerySection>
        sections={sections}
        keyExtractor={(row) => row.map((entry) => entry.id).join("-")}
        contentContainerStyle={[
          styles.content,
          {
            paddingLeft: side.paddingLeft,
            paddingRight: side.paddingRight,
            paddingBottom: selectMode ? 0 : 24,
          },
        ]}
        ListHeaderComponent={
          <View style={styles.header}>
            <NativeSegmentedControl<GalleryCategory>
              accessibilityLabel={t("Filter by type")}
              value={category}
              onChange={changeCategory}
              options={[
                { value: "all", label: t("All") },
                { value: "image", label: t("Images") },
                { value: "video", label: t("Videos") },
              ]}
            />
            <Pressable accessibilityRole="button" onPress={cycleSort} style={styles.sortButton}>
              <Text style={styles.sortLabel}>{t(gallerySortLabelKey(sort))}</Text>
            </Pressable>
          </View>
        }
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={styles.groupTitle}>{section.title}</Text> : null
        }
        renderItem={({ item: row }) => (
          <View style={styles.row}>
            {row.map((entry) => (
              <GalleryTile
                key={entry.id}
                item={entry}
                botName={entry.botId ? botsById[entry.botId] : undefined}
                locale={locale}
                selected={selectedIds.has(entry.id)}
                selectMode={selectMode}
                onPress={() => openItem(entry)}
                onLongPress={() => longPressItem(entry)}
                onDownload={() => void downloadItem(entry)}
                downloading={downloadingId === entry.id}
              />
            ))}
            {Array.from({ length: 3 - row.length }, (_, index) => (
              <View key={`empty-${index}`} style={styles.tileSpacer} />
            ))}
          </View>
        )}
        ListEmptyComponent={
          items === null ? (
            <View style={styles.empty}>
              <ActivityIndicator color={tokens.mutedForeground} />
            </View>
          ) : loadError ? (
            <Text style={styles.emptyError}>{loadError}</Text>
          ) : (
            <Text style={styles.empty}>{emptyMessage}</Text>
          )
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(sort, "refresh").finally(() => setRefreshing(false));
            }}
          />
        }
      />
      {selectMode ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom }]}>
          {saveError || deleteError ? (
            <Text role="alert" style={styles.inlineError}>
              {saveError ?? deleteError}
            </Text>
          ) : null}
          <View style={styles.bottomRow}>
            <Text style={styles.count}>{t("{count} selected", { count: selectedIds.size })}</Text>
            <Pressable
              accessibilityRole="button"
              disabled={saveBusy || deleteBusy}
              onPress={() => void saveSelected()}
              style={styles.saveButton}
            >
              <Text style={styles.saveLabel}>{saveBusy ? t("Saving…") : t("Save to device")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={saveBusy || deleteBusy}
              onPress={askDelete}
              style={styles.actionButton}
            >
              <Text style={styles.deleteLabel}>{deleteBusy ? t("Deleting…") : t("Delete")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={saveBusy || deleteBusy}
              onPress={() => setSelectedIds(new Set())}
              style={styles.actionButton}
            >
              <Text style={styles.cancelLabel}>{t("Cancel")}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function GalleryTile({
  item,
  botName,
  locale,
  selected,
  selectMode,
  onPress,
  onLongPress,
  onDownload,
  downloading,
}: {
  item: MobileArtifactSummary;
  botName: string | undefined;
  locale: UiLocale;
  selected: boolean;
  selectMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const tokens = useMobileTokens();
  const isImage = item.mimeType.startsWith("image/");
  const [thumbUri, setThumbUri] = useState<string | null>(null);
  const target = useMemo(() => artifactThreadTarget(item), [item.botId, item.groupId]);
  useEffect(() => {
    if (!isImage || !target) return;
    let cancelled = false;
    void imageArtifactUri(target, item.id, item.mimeType)
      .then((uri) => {
        if (!cancelled) setThumbUri(uri);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isImage, item.id, item.mimeType, target]);
  const subtitle = [
    galleryTileTime(item.createdAt, dateLocaleForUi(locale)),
    formatBytes(item.size),
    botName,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.tile}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.name}
        accessibilityHint={t("Long press to select")}
        accessibilityState={{ selected }}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={500}
        style={styles.tilePressable}
      >
        {isImage && thumbUri ? (
          <Image source={{ uri: thumbUri }} style={styles.thumb} />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <NativeSymbol
              ios={isImage ? "photo" : "play.fill"}
              android={isImage ? "image-outline" : "play-outline"}
              size={26}
              color={isImage ? tokens.mutedForeground : tokens.background}
            />
          </View>
        )}
        {selectMode ? (
          <View style={[styles.check, selected ? styles.checkOn : styles.checkOff]}>
            {selected ? <Text style={styles.checkMark}>✓</Text> : null}
          </View>
        ) : null}
      </Pressable>
      {selectMode ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Download")}
          disabled={downloading}
          onPress={onDownload}
          hitSlop={8}
          style={styles.tileDownload}
        >
          <NativeSymbol
            ios="square.and.arrow.down"
            android="download-outline"
            size={16}
            color="#ffffff"
          />
        </Pressable>
      )}
      <Text numberOfLines={1} style={styles.tileName}>
        {item.name}
      </Text>
      <Text numberOfLines={1} style={styles.tileSubtitle}>
        {subtitle}
      </Text>
    </View>
  );
}

function makeStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: tokens.background },
    content: { paddingTop: 16, paddingHorizontal: 16, gap: 16 },
    header: { flexDirection: "row", alignItems: "center", gap: 12 },
    sortButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: tokens.border,
    },
    sortLabel: { color: tokens.foreground, fontSize: 14 },
    groupTitle: { fontSize: 15, fontWeight: "600", color: tokens.foreground, marginTop: 8 },
    row: { flexDirection: "row", gap: 12 },
    tile: { flex: 1, gap: 4 },
    tileSpacer: { flex: 1 },
    tilePressable: { borderRadius: 10, overflow: "hidden", position: "relative" },
    thumb: { width: "100%", aspectRatio: 1 },
    thumbPlaceholder: {
      width: "100%",
      aspectRatio: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tokens.mutedForeground,
    },
    check: {
      position: "absolute",
      top: 8,
      right: 8,
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    tileDownload: {
      position: "absolute",
      top: 8,
      right: 8,
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0, 0, 0, 0.5)",
    },
    checkOn: { backgroundColor: tokens.primary },
    checkOff: { borderWidth: 2, borderColor: tokens.background },
    checkMark: { color: tokens.primaryForeground, fontSize: 14, fontWeight: "700" },
    tileName: { fontSize: 13, color: tokens.foreground },
    tileSubtitle: { fontSize: 12, color: tokens.mutedForeground },
    empty: { paddingVertical: 48, textAlign: "center", color: tokens.mutedForeground },
    emptyError: { paddingVertical: 48, textAlign: "center", color: tokens.destructive },
    bottomBar: { borderTopWidth: 1, borderTopColor: tokens.border, backgroundColor: tokens.card },
    bottomRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    count: { flex: 1, fontSize: 14, color: tokens.foreground },
    saveButton: {
      backgroundColor: tokens.primary,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    saveLabel: { color: tokens.primaryForeground, fontSize: 14, fontWeight: "600" },
    actionButton: { paddingHorizontal: 8, paddingVertical: 10 },
    deleteLabel: { color: tokens.destructive, fontSize: 14 },
    cancelLabel: { color: tokens.foreground, fontSize: 14 },
    inlineError: { color: tokens.destructive, fontSize: 13, paddingHorizontal: 16, paddingTop: 12 },
  });
}
