import { useEffect, useRef, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { WebView } from "react-native-webview";
import { WebView as TaskWebView } from "react-native-webview";
import {
  clientTaskWebViewError,
  clientTaskWebViewLoaded,
  clientTaskWebViewMessage,
  getClientTaskState,
  setClientTaskBridge,
  stopClientTask,
  subscribeClientTaskState,
} from "../lib/client-task-runner";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

function taskHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Hosts the running client task: a small banner saying the robot is using this phone's network,
 * with a Stop button, plus the hidden WebView that fetches the task page. The WebView is a
 * fresh instance per task (`key={taskId}`), loads only the task URL, and shares no cookies or
 * storage with anything else. Nothing renders while no task runs.
 */
export function ClientTaskHost() {
  const { task } = useSyncExternalStore(
    subscribeClientTaskState,
    getClientTaskState,
    getClientTaskState,
  );
  const tokens = useMobileTokens();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView | null>(null);
  const taskId = task?.taskId;
  useEffect(() => {
    if (!taskId) return;
    setClientTaskBridge({
      injectJavaScript: (js) => webViewRef.current?.injectJavaScript(js),
    });
    return () => setClientTaskBridge(undefined);
  }, [taskId]);
  if (!task) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <View style={[styles.banner, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
        <Text style={[styles.text, { color: tokens.foreground }]} numberOfLines={1}>
          {t("Robot is using your phone's network")}
        </Text>
        <Text style={[styles.host, { color: tokens.mutedForeground }]} numberOfLines={1}>
          {taskHost(task.url)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Stop")}
          hitSlop={8}
          onPress={() => stopClientTask()}
        >
          <Text style={[styles.stop, { color: tokens.destructive }]}>{t("Stop")}</Text>
        </Pressable>
      </View>
      <TaskWebView
        key={task.taskId}
        ref={(view) => {
          webViewRef.current = view;
        }}
        source={{ uri: task.url }}
        originWhitelist={["https://*", "http://*"]}
        javaScriptEnabled
        domStorageEnabled={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        cacheEnabled={false}
        style={styles.hidden}
        onLoad={() => clientTaskWebViewLoaded(task.taskId)}
        onMessage={(event) => clientTaskWebViewMessage(task.taskId, event.nativeEvent.data)}
        onError={() => clientTaskWebViewError(task.taskId)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    alignItems: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "100%",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  text: {
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  host: {
    fontSize: 13,
    flexShrink: 1,
  },
  stop: {
    fontSize: 13,
    fontWeight: "600",
  },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
});
