import { withConnectionName } from "@rakazo/contracts";
import type { ChatModelChoice } from "@rakazo/core";
import { groupModelChoices, modelChoiceSearchText } from "@rakazo/core";
import { useNavigation } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { ViewToken } from "react-native";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFloatingHeaderInset } from "../lib/floating-header";
import { useI18n } from "../lib/i18n";
import type { ModelTestResult } from "../lib/model-test-result";
import { modelTestLineColor, modelTestRowLine } from "../lib/model-test-result";
import { native, useMobileTokens, useThemedStyles } from "../lib/native";
import { useSideInsets } from "../lib/side-insets";
import { useListSearch } from "../lib/use-list-search";
import { ListSearchInput } from "./list-search-input";
import { Checkmark } from "./row-accessories";
import { SettingsLabel, SettingsRow } from "./settings-group";
import { TextOnlyMark } from "./text-only-mark";

/**
 * What the model test run shows in the list: per-row results, the run's
 * progress markers, and the "only available" filter. Absent on screens
 * without a test run, where the list behaves exactly as before.
 */
export type ModelPickerTestDisplay = {
  /** Results by picker row key, including the space default's own key. */
  results: ReadonlyMap<string, ModelTestResult>;
  /** Rows a single-model retest is running for right now. */
  testingKeys: ReadonlySet<string>;
  /** Rows without a result when the run stopped. */
  interruptedKeys: ReadonlySet<string>;
  interruptedAt: number | null;
  /** True once a run has started today; before that no test lines show. */
  hasRun: boolean;
  onlyAvailable: boolean;
  availableCount: number;
  /** False until a same-day run has results to filter by. */
  showFilter: boolean;
  onToggleOnlyAvailable: () => void;
};

/** Searchable grouped model cells shared by chat and connection settings. */
export function ModelPickerList({
  choices,
  selectedKey,
  locateKey,
  onSelect,
  error,
  providerLabel,
  emptyMessage,
  connectChoices,
  isRemovable,
  onRemove,
  test,
}: {
  choices: readonly ChatModelChoice[] | null;
  /** Providers that need a connection first, listed after the models. */
  connectChoices?: readonly ChatModelChoice[];
  selectedKey: string;
  /** A row to scroll to and tag "located here", from a switch-history tap. */
  locateKey?: string | null;
  onSelect: (choice: ChatModelChoice) => void;
  error?: string | null;
  emptyMessage?: string;
  /** A single-provider picker only needs vendor headings. */
  providerLabel?: string;
  /** Rows that can be swiped left to remove from their connection. */
  isRemovable?: (choice: ChatModelChoice) => boolean;
  /** Called when the swipe-to-remove action is tapped for a removable row. */
  onRemove?: (choice: ChatModelChoice) => void;
  test?: ModelPickerTestDisplay;
}) {
  const { t } = useI18n();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const sideInsets = useSideInsets();
  const styles = useThemedStyles(createStyles);
  const mobileTokens = useMobileTokens();
  const headerInset = useFloatingHeaderInset();
  const list = useRef<SectionList<ChatModelChoice>>(null);
  const initialScroll = useRef({
    ready: false,
    handled: false,
    cancelled: false,
    retried: false,
    target: null as { sectionIndex: number; itemIndex: number; key: string } | null,
  });
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelInitialScroll = useCallback(() => {
    initialScroll.current.cancelled = true;
    if (retry.current !== null) clearTimeout(retry.current);
  }, []);
  useEffect(
    () => () => {
      if (retry.current !== null) clearTimeout(retry.current);
    },
    [],
  );
  const rows = [
    ...(choices ?? []).map((choice) => ({ choice, connect: false })),
    ...(connectChoices ?? []).map((choice) => ({
      choice: { ...choice, providerLabel: undefined },
      connect: true,
    })),
  ];
  const { query, setQuery, showSearch, visible } = useListSearch(rows, {
    text: (row) => modelChoiceSearchText(row.choice),
  });
  const changeQuery = useCallback(
    (text: string) => {
      cancelInitialScroll();
      setQuery(text);
    },
    [cancelInitialScroll],
  );
  useLayoutEffect(() => {
    if (Platform.OS === "android") return;
    navigation.setOptions({
      headerSearchBarOptions: showSearch
        ? {
            placeholder: t("Search"),
            hideWhenScrolling: false,
            hideNavigationBar: false,
            autoCapitalize: "none",
            onChangeText: (event: { nativeEvent: { text: string } }) =>
              changeQuery(event.nativeEvent.text),
            onCancelButtonPress: () => changeQuery(""),
            onClose: () => changeQuery(""),
          }
        : undefined,
    });
  }, [navigation, t, changeQuery, showSearch]);

  // "Only available" hides every row whose latest same-day result is not usable.
  const testVisible = useMemo(() => {
    if (!test?.onlyAvailable) return visible;
    return visible.filter(
      (row) => !row.connect && test.results.get(row.choice.key)?.state === "ok",
    );
  }, [visible, test]);

  // Pass counts come from the whole group, not the search or the filter:
  // "2/5" stays 2/5 while only the two usable rows show.
  const passCounts = useMemo(() => {
    if (!test || test.results.size === 0 || !choices) return null;
    const counts = new Map<string, { ok: number; total: number }>();
    for (const section of groupModelChoices(choices, "")) {
      counts.set(section.key, {
        ok: section.data.filter((item) => test.results.get(item.key)?.state === "ok").length,
        total: section.data.length,
      });
    }
    return counts;
  }, [choices, test]);

  const sections = useMemo(() => {
    if (!choices) return [];
    const models = groupModelChoices(
      testVisible.flatMap((row) => (row.connect ? [] : [row.choice])),
      "",
    ).map((section) => {
      const base =
        providerLabel && section.heading === providerLabel
          ? undefined
          : providerLabel && section.heading?.endsWith(withConnectionName("", providerLabel))
            ? section.heading.slice(0, -withConnectionName("", providerLabel).length)
            : section.heading;
      const count = passCounts?.get(section.key);
      return {
        ...section,
        connect: false,
        heading: count
          ? `${base ?? t("Space default")} · ${t("{passed}/{total} passed", {
              passed: count.ok,
              total: count.total,
            })}`
          : base,
      };
    });
    const connect = groupModelChoices(
      testVisible.flatMap((row) => (row.connect ? [row.choice] : [])),
      "",
    ).flatMap((section) => section.data);
    return connect.length
      ? [...models, { key: "connect", heading: undefined, connect: true, data: connect }]
      : models;
  }, [choices, testVisible, providerLabel, passCounts, t]);
  useLayoutEffect(() => {
    const state = initialScroll.current;
    if (state.handled || state.cancelled || choices === null) return;
    state.ready = true;
    // A locate target outranks the selection: the list opens on the model
    // a switch-history tap named, not on the bot's current model.
    const targetKey = locateKey ?? selectedKey;
    state.target = null;
    for (const [sectionIndex, section] of sections.entries()) {
      const itemIndex = section.data.findIndex((item) => item.key === targetKey);
      if (itemIndex !== -1) {
        state.target = { sectionIndex, itemIndex, key: targetKey };
        break;
      }
    }
  }, [choices, sections, selectedKey, locateKey]);

  // Viewability is reported after layout, including when an async catalog arrives.
  const revealInitialSelection = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<ChatModelChoice>[] }) => {
      const state = initialScroll.current;
      if (
        !state.ready ||
        state.handled ||
        state.cancelled ||
        !viewableItems.some((item) => item.index !== null)
      )
        return;
      state.handled = true;
      if (
        !state.target ||
        viewableItems.some((item) => item.index !== null && item.item.key === state.target?.key)
      )
        return;
      list.current?.scrollToLocation({
        sectionIndex: state.target.sectionIndex,
        itemIndex: state.target.itemIndex,
        viewPosition: 0.5,
        animated: false,
      });
    },
    [],
  );

  const retryInitialSelection = useCallback(
    ({ averageItemLength, index }: { averageItemLength: number; index: number }) => {
      const state = initialScroll.current;
      if (!state.handled || state.cancelled || state.retried || !state.target) return;
      state.retried = true;
      // Move the render window near an unmeasured row before trying its location once more.
      list.current
        ?.getScrollResponder()
        ?.scrollTo({ y: averageItemLength * index, animated: false });
      retry.current = setTimeout(() => {
        if (!state.cancelled && state.target) {
          list.current?.scrollToLocation({
            sectionIndex: state.target.sectionIndex,
            itemIndex: state.target.itemIndex,
            viewPosition: 0.5,
            animated: false,
          });
        }
      }, 100);
    },
    [],
  );

  const noMatchesMessage = emptyMessage ?? t("No matching models");
  const noMatches = choices !== null && sections.length === 0;

  // The search field keeps focus, so tell screen readers once when the results run out.
  useEffect(() => {
    if (noMatches) AccessibilityInfo.announceForAccessibility(noMatchesMessage);
  }, [noMatches, noMatchesMessage]);

  return (
    <SectionList
      ref={list}
      onViewableItemsChanged={revealInitialSelection}
      onScrollToIndexFailed={retryInitialSelection}
      onScrollBeginDrag={cancelInitialScroll}
      key={Platform.OS === "android" ? "android" : query}
      style={[styles.screen, sideInsets]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: headerInset + 16, paddingBottom: insets.bottom + 72 },
      ]}
      // Reserve the transparent bar explicitly: native search can drop its automatic inset.
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior={headerInset > 0 ? "never" : "automatic"}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      sections={sections}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) =>
        section.heading ? (
          <View style={styles.sectionHeading}>
            <SettingsLabel>{section.heading}</SettingsLabel>
          </View>
        ) : null
      }
      renderSectionFooter={() => <View style={styles.sectionGap} />}
      keyExtractor={(choice) => choice.key || "space-default"}
      ItemSeparatorComponent={() => (
        <View style={styles.cell}>
          <View style={styles.separator} />
        </View>
      )}
      ListHeaderComponent={
        (Platform.OS === "android" && showSearch) || test?.showFilter ? (
          <View>
            {Platform.OS === "android" && showSearch ? (
              <ListSearchInput query={query} setQuery={changeQuery} />
            ) : null}
            {test?.showFilter ? (
              <View style={styles.filterRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Only available")}
                  accessibilityState={{ selected: test.onlyAvailable }}
                  onPress={test.onToggleOnlyAvailable}
                  style={[
                    styles.filterChip,
                    {
                      borderColor: test.onlyAvailable ? mobileTokens.link : mobileTokens.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.filterDot,
                      { borderColor: mobileTokens.mutedForeground },
                      test.onlyAvailable && {
                        backgroundColor: mobileTokens.link,
                        borderColor: mobileTokens.link,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.filterLabel,
                      {
                        color: test.onlyAvailable ? mobileTokens.link : mobileTokens.foreground,
                      },
                    ]}
                  >
                    {t("Only available")}
                  </Text>
                </Pressable>
                <Text style={[styles.filterCount, { color: mobileTokens.mutedForeground }]}>
                  {t("Available now: {count}", { count: test.availableCount })}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null
      }
      ListEmptyComponent={
        error || noMatches ? (
          <Text style={styles.empty}>{error ?? noMatchesMessage}</Text>
        ) : (
          <ActivityIndicator color={native.secondaryLabel} />
        )
      }
      renderItem={({ item, index, section }) => {
        const selected = item.key === selectedKey;
        const located = locateKey != null && item.key === locateKey;
        const testLine =
          test?.hasRun && !section.connect
            ? modelTestRowLine({
                result: test.results.get(item.key) ?? null,
                testing: test.testingKeys.has(item.key),
                interrupted: test.interruptedKeys.has(item.key),
                interruptedAt: test.interruptedAt,
                images: item.images,
                t,
              })
            : null;
        const cell = (
          <View
            style={[
              styles.cell,
              index === 0 && styles.first,
              index === section.data.length - 1 && styles.last,
              // The located row keeps the list's own background and gains the
              // accent wash, so it reads as "this is the one" without a second
              // checkmark fighting the selected row's.
              located && { backgroundColor: mobileTokens.accent },
            ]}
          >
            <SettingsRow
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityHint={item.images === false ? t("Can't read images") : undefined}
              accessibilityState={{ selected }}
              onPress={() => onSelect(item)}
              title={item.title ?? item.label}
              detail={testLine?.text ?? item.detail}
              detailColor={testLine ? modelTestLineColor(testLine.tone, mobileTokens) : undefined}
              value={section.connect ? t("Connect") : undefined}
              chevron={section.connect ? "right" : undefined}
              trailing={
                located || item.images === false || selected ? (
                  <View style={styles.trailing}>
                    {located ? (
                      <Text
                        style={{
                          color: mobileTokens.link,
                          fontSize: 13,
                          fontWeight: "600",
                        }}
                      >
                        {t("Located here")}
                      </Text>
                    ) : null}
                    {item.images === false ? <TextOnlyMark /> : null}
                    {selected ? <Checkmark /> : null}
                  </View>
                ) : null
              }
            />
          </View>
        );
        if (section.connect || !isRemovable?.(item) || !onRemove) return cell;
        const last = index === section.data.length - 1;
        return (
          <Swipeable
            renderRightActions={() => (
              <View
                style={[
                  styles.removeAction,
                  { backgroundColor: mobileTokens.destructiveFill },
                  index === 0 && styles.removeActionFirst,
                  last && styles.removeActionLast,
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Remove")}
                  onPress={() => onRemove(item)}
                  style={styles.removeButton}
                >
                  <Text style={[styles.removeLabel, { color: mobileTokens.destructiveForeground }]}>
                    {t("Remove")}
                  </Text>
                </Pressable>
              </View>
            )}
          >
            {cell}
          </Swipeable>
        );
      }}
    />
  );
}

function createStyles() {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.page },
    content: { paddingHorizontal: 16 },
    sectionHeading: { paddingBottom: 7 },
    sectionGap: { height: 20 },
    filterRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingTop: 12,
      paddingBottom: 4,
    },
    filterChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 13,
      paddingVertical: 7,
    },
    filterDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
    filterLabel: { fontSize: 14 },
    filterCount: { fontSize: 13 },
    trailing: { flexDirection: "row", alignItems: "center", gap: 10 },
    cell: { backgroundColor: native.fill, overflow: "hidden" },
    first: { borderTopLeftRadius: 16, borderTopRightRadius: 16, borderCurve: "continuous" },
    last: { borderBottomLeftRadius: 16, borderBottomRightRadius: 16, borderCurve: "continuous" },
    removeAction: { justifyContent: "center", width: 88 },
    removeActionFirst: { borderTopRightRadius: 16, borderCurve: "continuous" },
    removeActionLast: { borderBottomRightRadius: 16, borderCurve: "continuous" },
    removeButton: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 12,
    },
    removeLabel: { fontSize: 15, fontWeight: "600" },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginStart: 16,
      backgroundColor: native.separator,
    },
    empty: {
      color: native.secondaryLabel,
      fontSize: 15,
      paddingHorizontal: 16,
      paddingVertical: 10,
      textAlign: "center",
    },
  });
}
