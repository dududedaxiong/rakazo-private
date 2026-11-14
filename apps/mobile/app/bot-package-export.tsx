import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { lazy, Suspense, useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, ScrollView, Text } from "react-native";
import { NativeActionButton } from "../components/native-action-button";
import { cancelHeaderOptions } from "../components/sheet-header";
import type { MobileBotPackageClient } from "../lib/bot-package-client";
import { mobileBotPackageClient } from "../lib/bot-package-client";
import { useI18n } from "../lib/i18n";
import type { MobileScope } from "../lib/mobile-scope";
import { captureMobileScope, mobileScopeKey, subscribeMobileScope } from "../lib/mobile-scope";
import { native, useMobileTokens } from "../lib/native";
import { currentReadySessionGeneration, subscribeSessionGeneration } from "../lib/session";

const NativeBotPackageExport = lazy(() =>
  import("../components/bot-package-tools").then((module) => ({
    default: module.NativeBotPackageExport,
  })),
);

export default function BotPackageExportScreen() {
  const scopeKey = useSyncExternalStore(subscribeMobileScope, mobileScopeKey, mobileScopeKey);
  const scope = useMemo(captureMobileScope, [scopeKey]);
  const ready = useSyncExternalStore(
    subscribeSessionGeneration,
    currentReadySessionGeneration,
    currentReadySessionGeneration,
  );
  const params = useLocalSearchParams<{ botId?: string }>();
  const botId = typeof params.botId === "string" ? params.botId : "";
  return ready === scope.sessionGeneration ? (
    <BotPackageExportEditor key={scopeKey} scope={scope} botId={botId} />
  ) : (
    <ActivityIndicator />
  );
}

function BotPackageExportEditor({ scope, botId }: { scope: MobileScope; botId: string }) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const router = useRouter();
  const [client, setClient] = useState<MobileBotPackageClient | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!botId) return;
      let active = true;
      setClient(null);
      setFailed(false);
      void mobileBotPackageClient(scope, () => active)
        .then((next) => {
          if (next.isCurrent()) setClient(next);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
      return () => {
        active = false;
        setClient(null);
      };
    }, [scope, botId, reload]),
  );
  return (
    <>
      <Stack.Screen options={cancelHeaderOptions(t("Cancel"), () => router.back())} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: tokens.background }}
        contentContainerStyle={{ padding: 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Suspense fallback={<ActivityIndicator />}>
          {!botId ? (
            <>
              <Text
                accessibilityRole="alert"
                style={{ fontSize: 14, color: native.secondaryLabel }}
              >
                {t("Could not export this package.")}
              </Text>
              <NativeActionButton
                label={t("Close")}
                prominence="quiet"
                onPress={() => router.back()}
              />
            </>
          ) : failed ? (
            <NativeActionButton
              label={t("Retry package settings")}
              onPress={() => setReload((value) => value + 1)}
              prominence="secondary"
            />
          ) : client ? (
            <NativeBotPackageExport botId={botId} client={client} />
          ) : (
            <ActivityIndicator />
          )}
        </Suspense>
      </ScrollView>
    </>
  );
}
