import type { BotModelEntry } from "@rakazo_mickvvw/contracts";
import { moveBotModelToFront } from "@rakazo_mickvvw/contracts";
import type { ChatModelChoice } from "@rakazo_mickvvw/core";
import { useNavigation } from "expo-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Modal, Platform, Text, useWindowDimensions, View } from "react-native";
import { rpc } from "../../lib/api";
import { mobileTokens } from "../../lib/appearance";
import { chatModelPickerChoices } from "../../lib/chat-model";
import { useI18n } from "../../lib/i18n";
import type { MobileMe, MobileModelCredential } from "../../lib/mobile-types";
import { removableModel, removeModelFromConnection } from "../../lib/model-removal";
import { locateModelChoiceKey } from "../../lib/model-switches";
import type { ModelTestResult } from "../../lib/model-test-result";
import { formatModelTestClock } from "../../lib/model-test-result";
import {
  buildModelTestItems,
  getModelTestRunStore,
  modelKeyForChoice,
  testItemForChoice,
} from "../../lib/model-test-run";
import { errorText } from "../../lib/user-error";
import type { ModelPickerTestDisplay } from "../model-picker-list";
import { ModelPickerList } from "../model-picker-list";
import { ModelTestRowMenu } from "../model-test-row-menu";
import { NativeActionButton } from "../native-action-button";
import { NativeSheet, useNativeSheet } from "../native-sheet";

export type ThreadModelPickerRole = "main" | "computer" | "video" | "image" | "translation";

export type ThreadModelSave = {
  provider: string | null;
  modelId: string | null;
};

/**
 * The model picker as a bottom sheet from the chat's quick-access cards, so a pick lands
 * without leaving the chat. Android uses the native bottom sheet; iOS uses a form sheet,
 * and Android without the native sheet falls back to a modal, following BotOrganizeModal.
 *
 * Tapping a row opens its menu (detail, switch, retest, remove) instead of
 * selecting it. The model test runs in a module-level store, so closing the
 * sheet never stops a run; reopening shows live progress and same-day results.
 */
export function ThreadModelPickerSheet({
  visible,
  role,
  botId,
  userId,
  selectedKey,
  /** The bot's current ordered list for the video/image role; a pick moves to its front. */
  currentModels,
  /** A model a switch-history tap wants located: scrolled to and tagged, not selected. */
  locate,
  onClose,
  onSaved,
}: {
  visible: boolean;
  role: ThreadModelPickerRole;
  botId: string;
  userId: string;
  selectedKey: string;
  currentModels?: readonly BotModelEntry[] | null;
  locate?: { model: string; provider?: string | null } | null;
  onClose: () => void;
  onSaved: (choice: ThreadModelSave) => void;
}) {
  const { t } = useI18n();
  const tokens = mobileTokens();
  const navigation = useNavigation();
  const Sheet = useNativeSheet();
  const { height } = useWindowDimensions();
  const [me, setMe] = useState<MobileMe | null>(null);
  const [choices, setChoices] = useState<ChatModelChoice[] | null>(null);
  const [credentials, setCredentials] = useState<MobileModelCredential[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [menuChoice, setMenuChoice] = useState<ChatModelChoice | null>(null);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  /**
   * The row a switch-history tap locates: matched by model id plus the
   * connection display name (providerLabel), so two rows for the same model
   * on different connections stay distinct. A locate without a connection
   * (a trailing mark names only the model) prefers the bot's current model
   * row when it names that model. Falls back to the model id alone, then
   * to no highlight when the model is not listed.
   */
  const locateKey = useMemo(
    () => locateModelChoiceKey(choices ?? [], locate, selectedKey || null),
    [choices, locate, selectedKey],
  );
  const testRun = getModelTestRunStore();
  const testSnapshot = useSyncExternalStore(testRun.subscribe, testRun.getSnapshot);
  const title =
    role === "main"
      ? t("Main model")
      : role === "computer"
        ? t("Computer model")
        : role === "video"
          ? t("Video generation model")
          : role === "image"
            ? t("Image generation model")
            : t("Translation model");

  // The store keys results by model; rows key by picker key, so the space
  // default row reads the result of the model behind it.
  const resultsByChoiceKey = useMemo(() => {
    const map = new Map<string, ModelTestResult>();
    for (const choice of choices ?? []) {
      const key = modelKeyForChoice(choice, me);
      const result = key ? testSnapshot.results.get(key) : undefined;
      if (result) map.set(choice.key, result);
    }
    return map;
  }, [choices, me, testSnapshot.results]);
  const testingChoiceKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const choice of choices ?? []) {
      if (testSnapshot.testingKeys.has(modelKeyForChoice(choice, me))) keys.add(choice.key);
    }
    return keys;
  }, [choices, me, testSnapshot.testingKeys]);
  const interruptedChoiceKeys = useMemo(() => {
    const keys = new Set<string>();
    if (testSnapshot.status !== "interrupted") return keys;
    for (const choice of choices ?? []) {
      if (testSnapshot.queuedKeys.includes(modelKeyForChoice(choice, me))) {
        keys.add(choice.key);
      }
    }
    return keys;
  }, [choices, me, testSnapshot.status, testSnapshot.queuedKeys]);
  const availableCount = useMemo(() => {
    let count = 0;
    for (const result of resultsByChoiceKey.values()) {
      if (result.state === "ok") count += 1;
    }
    return count;
  }, [resultsByChoiceKey]);
  const testDisplay: ModelPickerTestDisplay = useMemo(
    () => ({
      results: resultsByChoiceKey,
      testingKeys: testingChoiceKeys,
      interruptedKeys: interruptedChoiceKeys,
      interruptedAt: testSnapshot.interruptedAt,
      hasRun: testSnapshot.status !== "idle",
      onlyAvailable,
      availableCount,
      showFilter: testSnapshot.results.size > 0,
      onToggleOnlyAvailable: () => setOnlyAvailable((value) => !value),
    }),
    [
      resultsByChoiceKey,
      testingChoiceKeys,
      interruptedChoiceKeys,
      testSnapshot.interruptedAt,
      testSnapshot.status,
      testSnapshot.results,
      onlyAvailable,
      availableCount,
    ],
  );

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setChoices(null);
    setCredentials(null);
    setLoadError(null);
    setError(null);
    void Promise.all([rpc("me"), rpc("models/list"), rpc("models/credentials")])
      .then(([nextMe, catalog, credentials]) => {
        if (cancelled) return;
        setMe(nextMe);
        setCredentials(credentials);
        setChoices(chatModelPickerChoices(nextMe, catalog, credentials, selectedKey, t));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorText(err, t("Could not load model settings")));
      });
    return () => {
      cancelled = true;
    };
  }, [visible, selectedKey, t]);

  // The list puts its search bar on this screen's header on iOS; clear it when the
  // sheet goes away so the chat header does not keep a search bar behind it.
  useEffect(
    () => () => {
      navigation.setOptions({ headerSearchBarOptions: undefined });
    },
    [navigation],
  );

  async function select(choice: ChatModelChoice) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const provider = choice.provider ?? null;
      const modelId = choice.modelId ?? null;
      if (role === "main") {
        await rpc("bots/update", { botId, modelProvider: provider, modelId });
      } else if (role === "video" || role === "image" || role === "translation") {
        // A pick moves to the front of the ordered list; the rest stay as
        // fallbacks. Picking the space default clears the list.
        const next =
          provider && modelId
            ? moveBotModelToFront(currentModels, { provider, model: modelId })
            : [];
        await rpc("bots/update", {
          botId,
          ...(role === "video"
            ? { videoModels: next }
            : role === "image"
              ? { imageModels: next }
              : { translationModels: next }),
        });
      } else {
        await rpc("models/setRole", {
          role: "computer",
          expectedUserId: userId,
          scope: "account",
          primary: provider && modelId ? { provider, modelId } : null,
        });
      }
      onSaved({ provider, modelId });
      onClose();
    } catch (err) {
      setError(errorText(err, t("Could not save that model")));
    } finally {
      setSaving(false);
    }
  }

  async function reloadChoices() {
    try {
      const [nextMe, catalog, nextCredentials] = await Promise.all([
        rpc("me"),
        rpc("models/list"),
        rpc("models/credentials"),
      ]);
      setMe(nextMe);
      setCredentials(nextCredentials);
      setChoices(chatModelPickerChoices(nextMe, catalog, nextCredentials, selectedKey, t));
    } catch (err) {
      setLoadError(errorText(err, t("Could not load model settings")));
    }
  }

  /** Removes a swiped model from its connection; the row drops at once and the reload confirms it. */
  async function removeChoice(choice: ChatModelChoice) {
    const target = removableModel(credentials ?? [], choice, choices ?? []);
    if (!target || saving) return;
    setSaving(true);
    setError(null);
    setChoices((prev) => prev?.filter((item) => item.key !== choice.key) ?? null);
    try {
      await removeModelFromConnection(target);
      const removed =
        choice.provider && choice.modelId
          ? { provider: choice.provider, model: choice.modelId }
          : null;
      if (choice.key === selectedKey) {
        if (role === "main") {
          await rpc("bots/update", { botId, modelProvider: null, modelId: null });
        } else if (role === "video" || role === "image" || role === "translation") {
          // Dropping a listed model removes it from the ordered list; the
          // next entry becomes primary.
          const next = (currentModels ?? []).filter(
            (item) =>
              !(removed && item.provider === removed.provider && item.model === removed.model),
          );
          await rpc("bots/update", {
            botId,
            ...(role === "video"
              ? { videoModels: next }
              : role === "image"
                ? { imageModels: next }
                : { translationModels: next }),
          });
        } else {
          await rpc("models/setRole", {
            role: "computer",
            expectedUserId: userId,
            scope: "account",
            primary: null,
          });
        }
        onSaved({ provider: null, modelId: null });
      } else if ((role === "video" || role === "image" || role === "translation") && removed) {
        // A fallback was removed: save the list without it, primary unchanged.
        const next = (currentModels ?? []).filter(
          (item) => !(item.provider === removed.provider && item.model === removed.model),
        );
        if (next.length !== (currentModels ?? []).length) {
          await rpc("bots/update", {
            botId,
            ...(role === "video"
              ? { videoModels: next }
              : role === "image"
                ? { imageModels: next }
                : { translationModels: next }),
          });
        }
      }
      await reloadChoices();
    } catch (err) {
      setError(errorText(err, t("Could not remove this model")));
      await reloadChoices();
    } finally {
      setSaving(false);
    }
  }

  /** Starts a test run in the background store; closing the sheet never stops it. */
  function startTestRun(resume: boolean) {
    if (!choices || !credentials) return;
    const items = buildModelTestItems(choices, credentials, me);
    if (items.length === 0) {
      setError(t("Could not test these models"));
      return;
    }
    setError(null);
    testRun.start(items, { resume });
  }

  /** Retests one model from its row menu; the row shows "testing" until it lands. */
  async function retestChoice(choice: ChatModelChoice) {
    const item = testItemForChoice(choice, credentials ?? [], me);
    if (!item) return;
    await testRun.retestOne(item);
  }

  if (!visible || Sheet === undefined) return null;

  const runStatus =
    testSnapshot.status === "interrupted" && testSnapshot.done >= testSnapshot.total
      ? "done"
      : testSnapshot.status;
  const progress =
    testSnapshot.total > 0 ? Math.round((testSnapshot.done / testSnapshot.total) * 100) : 0;
  // A run that finished with nothing tested — every probe failed — says so,
  // the way the old one-shot test did, instead of showing a bare 0/total.
  const runError =
    error ??
    (runStatus === "done" && testSnapshot.done === 0 && testSnapshot.total > 0
      ? t("Could not test these models")
      : null);

  const content = (
    <View
      style={{
        ...(Sheet ? { height: Math.floor(height * 0.72) } : { flex: 1 }),
        backgroundColor: tokens.card,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingHorizontal: 20,
          paddingTop: Sheet ? 4 : 12,
          paddingBottom: 8,
        }}
      >
        <Text style={{ color: tokens.foreground, fontSize: 17, fontWeight: "600" }}>{title}</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {runStatus === "running" ? (
            <>
              <NativeActionButton
                label={t("Testing {done}/{total}", {
                  done: testSnapshot.done,
                  total: testSnapshot.total,
                })}
                prominence="secondary"
                busy
                disabled
                onPress={() => undefined}
              />
              <NativeActionButton
                label={t("Abort test")}
                prominence="destructive"
                variant="text"
                onPress={() => testRun.abort()}
              />
            </>
          ) : runStatus === "interrupted" ? (
            <>
              <NativeActionButton
                label={t("Resume test {done}/{total}", {
                  done: testSnapshot.done,
                  total: testSnapshot.total,
                })}
                onPress={() => startTestRun(true)}
              />
              <NativeActionButton
                label={t("Retest")}
                prominence="quiet"
                onPress={() => startTestRun(false)}
              />
            </>
          ) : runStatus === "done" ? (
            <>
              <NativeActionButton
                label={t("Test finished {done}/{total}", {
                  done: testSnapshot.done,
                  total: testSnapshot.total,
                })}
                prominence="secondary"
                disabled
                onPress={() => undefined}
              />
              <NativeActionButton
                label={t("Retest")}
                prominence="quiet"
                onPress={() => startTestRun(false)}
              />
            </>
          ) : (
            <NativeActionButton
              disabled={!credentials || credentials.length === 0}
              label={t("Test all models")}
              prominence="secondary"
              onPress={() => startTestRun(false)}
            />
          )}
          <NativeActionButton label={t("Cancel")} prominence="plain" onPress={onClose} />
        </View>
      </View>
      {runStatus === "running" || runStatus === "interrupted" ? (
        <View>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              paddingHorizontal: 20,
            }}
          >
            <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
              {runStatus === "running"
                ? testSnapshot.currentLabel
                  ? t("Testing {model}", { model: testSnapshot.currentLabel })
                  : t("Testing…")
                : t("Last test interrupted at {time}", {
                    time: formatModelTestClock(testSnapshot.interruptedAt ?? Date.now()),
                  })}
            </Text>
            <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
              {testSnapshot.done}/{testSnapshot.total}
            </Text>
          </View>
          <View
            style={{
              marginHorizontal: 20,
              marginTop: 8,
              height: 4,
              borderRadius: 2,
              backgroundColor: tokens.border,
            }}
          >
            <View
              style={{
                height: "100%",
                width: `${progress}%`,
                borderRadius: 2,
                backgroundColor: tokens.link,
              }}
            />
          </View>
        </View>
      ) : null}
      {runError ? (
        <Text
          accessibilityRole="alert"
          style={{ color: tokens.destructive, paddingHorizontal: 20, paddingBottom: 8 }}
        >
          {runError}
        </Text>
      ) : null}
      <View style={{ flex: 1 }}>
        <ModelPickerList
          choices={choices}
          selectedKey={selectedKey}
          locateKey={locateKey}
          error={loadError}
          onSelect={(choice) => setMenuChoice(choice)}
          isRemovable={(choice) =>
            removableModel(credentials ?? [], choice, choices ?? []) !== null
          }
          onRemove={(choice) => void removeChoice(choice)}
          test={testDisplay}
        />
      </View>
      {menuChoice ? (
        <ModelTestRowMenu
          modelLabel={menuChoice.modelId ?? me?.defaultModel ?? menuChoice.label}
          providerLabel={menuChoice.providerLabel ?? t("Space default")}
          images={menuChoice.images}
          result={resultsByChoiceKey.get(menuChoice.key) ?? null}
          testing={testingChoiceKeys.has(menuChoice.key)}
          interrupted={interruptedChoiceKeys.has(menuChoice.key)}
          interruptedAt={testSnapshot.interruptedAt}
          isSelected={menuChoice.key === selectedKey}
          isRemovable={removableModel(credentials ?? [], menuChoice, choices ?? []) !== null}
          canRetest={
            testSnapshot.status !== "running" &&
            testItemForChoice(menuChoice, credentials ?? [], me) !== null
          }
          onSwitch={() => {
            setMenuChoice(null);
            void select(menuChoice);
          }}
          onRetest={() => {
            setMenuChoice(null);
            void retestChoice(menuChoice);
          }}
          onRemove={() => {
            setMenuChoice(null);
            void removeChoice(menuChoice);
          }}
          onClose={() => setMenuChoice(null)}
        />
      ) : null}
    </View>
  );

  if (Sheet) {
    return (
      <NativeSheet Sheet={Sheet} onClose={onClose} expanded label={title}>
        {content}
      </NativeSheet>
    );
  }
  if (Platform.OS === "ios") {
    return (
      <Modal visible animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
        {content}
      </Modal>
    );
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
        {content}
      </View>
    </Modal>
  );
}
