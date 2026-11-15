import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert } from "react-native";
import { rpc } from "../../lib/api";
import type { AvailableModel, AvailableModelProbe } from "../../lib/available-model-probe";
import {
  availableModelKey,
  availableModelsFromTestResults,
  isProviderModelError,
  probeAvailableModels,
  probeProviderIds,
  TEST_PROVIDER_TIMEOUT_MS,
} from "../../lib/available-model-probe";
import { useI18n } from "../../lib/i18n";
import { checkKeyForProvider } from "../../lib/key-health";
import type { MobileSnapshot } from "../../lib/mobile-types";
import type { ModelErrorActionKind } from "../../lib/model-error";
import { describeModelError, modelErrorActionLabel } from "../../lib/model-error";
import { keyCheckAlert } from "../../lib/model-error-alert";
import { openModelSettings } from "../../lib/model-settings";
import { getModelTestRunStore } from "../../lib/model-test-run";
import { runErrorActionLabel } from "../../lib/run-error-presentation";
import { errorText } from "../../lib/user-error";
import { useRunError } from "../run-error-sheet";

type ProbeState = Pick<AvailableModelProbe, "status" | "models">;

/** The chat's failed run: its error, the recovery action, and whether its details are open. */
export function useThreadRunError(
  run: MobileSnapshot["run"] | undefined,
  botId?: string,
  mainProvider?: string | null,
) {
  const { t } = useI18n();
  const router = useRouter();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const runError = run?.status === "failed" ? (run.error ?? null) : null;
  const normalizedRunError = useRunError(runError, false);
  const failedRunId = runError ? run?.id : null;
  const [probe, setProbe] = useState<ProbeState>({ status: "idle", models: [] });
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);
  const [handledRunId, setHandledRunId] = useState<string | null>(null);
  const probeGeneration = useRef(0);
  useEffect(() => {
    setDetailsOpen(false);
    setProbe({ status: "idle", models: [] });
    setSwitchingKey(null);
    setHandledRunId(null);
    probeGeneration.current += 1;
  }, [failedRunId]);
  const handled = handledRunId !== null && handledRunId === failedRunId;
  const label = normalizedRunError ? runErrorActionLabel(t, normalizedRunError) : null;
  const runBotId = run?.botId ?? botId;
  // The plain-language class of the failure: it picks the button the shared
  // classifier's recovery misses — a quota is fixed by switching provider,
  // and a transient failure still offers another model.
  const describedKey = runError ? describeModelError(runError).key : null;
  const openModelPicker = useCallback(() => {
    setDetailsOpen(false);
    if (runBotId)
      router.push({ pathname: "/bot-settings", params: { botId: runBotId, focus: "model" } });
    else openModelSettings();
  }, [router, runBotId]);
  const runErrorAction =
    describedKey === "quota"
      ? {
          label: t("Switch provider"),
          onPress: () => {
            setDetailsOpen(false);
            openModelSettings();
          },
        }
      : describedKey === "rate_limited" ||
          describedKey === "timeout" ||
          describedKey === "connection"
        ? { label: t("Change model"), onPress: openModelPicker }
        : label
          ? {
              label,
              // Without a bot to change, the model settings pick the default model instead.
              onPress:
                normalizedRunError?.recovery === "model" && runBotId
                  ? () => {
                      setDetailsOpen(false);
                      router.push({
                        pathname: "/bot-settings",
                        params: { botId: runBotId, focus: "model" },
                      });
                    }
                  : () => {
                      setDetailsOpen(false);
                      openModelSettings();
                    },
            }
          : null;
  // An invalid key gets the list-probe check next to the replace action: it
  // costs no tokens and says whether the saved key itself is the problem.
  const [keyChecking, setKeyChecking] = useState(false);
  const testKey = useCallback(() => {
    if (!mainProvider || keyChecking) return;
    setKeyChecking(true);
    void checkKeyForProvider(mainProvider).then(
      (checked) => {
        setKeyChecking(false);
        if (!checked) {
          Alert.alert(t("Could not check this key"));
          return;
        }
        keyCheckAlert(t, checked.result);
      },
      (err: unknown) => {
        setKeyChecking(false);
        Alert.alert(t("Could not check this key"), errorText(err, t("Try again.")));
      },
    );
  }, [mainProvider, keyChecking, t]);
  const runErrorExtraActions: {
    kind: ModelErrorActionKind;
    label: string;
    onPress: () => void;
    busy?: boolean;
  }[] =
    describedKey === "invalid_key" && mainProvider
      ? [
          {
            kind: "test-key",
            label: modelErrorActionLabel(t, "test-key"),
            onPress: testKey,
            busy: keyChecking,
          },
        ]
      : [];
  // A transient failure's way out of the details sheet is a labeled dismiss;
  // the inline notice stays until the next run, so it gets no dismiss button.
  const runErrorDismissAction: { label: string; onPress: () => void } | null =
    describedKey === "rate_limited"
      ? { label: modelErrorActionLabel(t, "try-later"), onPress: () => setDetailsOpen(false) }
      : describedKey === "timeout" || describedKey === "connection"
        ? {
            label: modelErrorActionLabel(t, "check-network"),
            onPress: () => setDetailsOpen(false),
          }
        : null;

  const probeAvailable = !handled && isProviderModelError(normalizedRunError);
  // The picker sheet's same-day test run: subscribing hydrates its stored
  // results, so the error box can list already-proven models at once.
  const testRun = getModelTestRunStore();
  const testRunSnapshot = useSyncExternalStore(testRun.subscribe, testRun.getSnapshot);
  const testAvailableModels = useCallback(() => {
    if (!probeAvailable || probe.status === "testing") return;
    const generation = ++probeGeneration.current;
    setProbe({ status: "testing", models: [] });
    void (async () => {
      const providers = probeProviderIds(runError, mainProvider);
      // A same-day test already proved some of the run's providers usable:
      // list those at once instead of re-testing every connection. Only the
      // catalog is fetched, to label them.
      const storedOk = [...testRunSnapshot.results.values()].filter(
        (result) => result.state === "ok" && providers.includes(result.provider),
      );
      if (storedOk.length > 0) {
        const catalog = await rpc("models/list").catch(() => []);
        if (probeGeneration.current !== generation) return;
        setProbe({
          status: "done",
          models: availableModelsFromTestResults(storedOk, providers, catalog),
        });
        return;
      }
      const models = await probeAvailableModels(
        {
          credentials: () => rpc("models/credentials"),
          catalog: () => rpc("models/list"),
          testProvider: (credentialId) =>
            rpc("models/testProvider", { credentialId }, { timeoutMs: TEST_PROVIDER_TIMEOUT_MS }),
        },
        runError,
        mainProvider,
      );
      if (probeGeneration.current === generation) setProbe({ status: "done", models });
    })().catch(() => {
      if (probeGeneration.current === generation) setProbe({ status: "failed", models: [] });
    });
  }, [probeAvailable, probe.status, runError, mainProvider, testRunSnapshot]);
  const switchToAvailableModel = useCallback(
    (model: AvailableModel) => {
      if (!runBotId || switchingKey !== null) return;
      const key = availableModelKey(model);
      setSwitchingKey(key);
      void rpc("bots/update", {
        botId: runBotId,
        modelProvider: model.provider,
        modelId: model.modelId,
      }).then(
        () => {
          setHandledRunId(failedRunId ?? null);
          setDetailsOpen(false);
          setSwitchingKey(null);
        },
        () => setSwitchingKey(null),
      );
    },
    [runBotId, switchingKey, failedRunId],
  );
  const modelProbe: AvailableModelProbe = {
    available: probeAvailable,
    status: probe.status,
    models: probe.models,
    switchingKey,
    onTest: testAvailableModels,
    onSelect: switchToAvailableModel,
  };
  return {
    runError,
    normalizedRunError,
    runErrorAction,
    runErrorExtraActions,
    runErrorDismissAction,
    keyChecking,
    detailsOpen,
    setDetailsOpen,
    handled,
    modelProbe,
  };
}
