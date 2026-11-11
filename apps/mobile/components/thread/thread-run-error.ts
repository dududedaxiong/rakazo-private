import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "../../lib/api";
import type { AvailableModel, AvailableModelProbe } from "../../lib/available-model-probe";
import {
  availableModelKey,
  isProviderModelError,
  probeAvailableModels,
  TEST_PROVIDER_TIMEOUT_MS,
} from "../../lib/available-model-probe";
import { useI18n } from "../../lib/i18n";
import type { MobileSnapshot } from "../../lib/mobile-types";
import { openModelSettings } from "../../lib/model-settings";
import { runErrorActionLabel } from "../../lib/run-error-presentation";
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
  const runErrorAction = label
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

  const probeAvailable = !handled && isProviderModelError(normalizedRunError);
  const testAvailableModels = useCallback(() => {
    if (!probeAvailable || probe.status === "testing") return;
    const generation = ++probeGeneration.current;
    setProbe({ status: "testing", models: [] });
    void probeAvailableModels(
      {
        credentials: () => rpc("models/credentials"),
        catalog: () => rpc("models/list"),
        testProvider: (credentialId) =>
          rpc("models/testProvider", { credentialId }, { timeoutMs: TEST_PROVIDER_TIMEOUT_MS }),
      },
      runError,
      mainProvider,
    ).then(
      (models) => {
        if (probeGeneration.current === generation) setProbe({ status: "done", models });
      },
      () => {
        if (probeGeneration.current === generation) setProbe({ status: "failed", models: [] });
      },
    );
  }, [probeAvailable, probe.status, runError, mainProvider]);
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
    detailsOpen,
    setDetailsOpen,
    handled,
    modelProbe,
  };
}
