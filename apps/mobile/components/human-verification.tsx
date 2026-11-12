import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** A minimal page that renders the human-verification widget and reports its token back. */
function challengeHtml(siteKey: string): string {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<script src="${SCRIPT_URL}" async defer></script>
<style>body{margin:0;display:flex;justify-content:center;background:transparent}</style>
</head><body><div id="widget"></div>
<script>
function renderWidget() {
  if (!window.turnstile) return setTimeout(renderWidget, 100);
  window.turnstile.render("#widget", {
    sitekey: "${siteKey}",
    callback: function (token) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "token", token: token }));
    },
    "expired-callback": function () {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "expired" }));
    },
    "error-callback": function () {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "error" }));
    },
  });
}
renderWidget();
</script></body></html>`;
}

/**
 * Renders the human-verification challenge for sign-up. The site key is public;
 * the secret stays on the server. The widget reports a one-time token that the
 * app sends with the sign-up request.
 */
export function HumanVerification({
  siteKey,
  resetKey,
  onToken,
}: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string | null) => void;
}) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const html = useMemo(() => challengeHtml(siteKey), [siteKey]);

  if (failed) {
    return (
      <View style={{ marginTop: 16, alignItems: "center" }}>
        <Text style={{ color: tokens.destructive, fontSize: 14 }}>
          {t("Could not load human verification")}
        </Text>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
          style={{ marginTop: 8, paddingHorizontal: 4 }}
        >
          <Text style={{ color: tokens.foreground, fontSize: 14, fontWeight: "600" }}>
            {t("Retry")}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ marginTop: 16, minHeight: 65 }}>
      <ActivityIndicator
        color={tokens.mutedForeground}
        style={{ position: "absolute", alignSelf: "center", top: 20 }}
      />
      <WebView
        key={`${resetKey}-${attempt}`}
        source={{ html }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled={false}
        sharedCookiesEnabled={false}
        scrollEnabled={false}
        style={{ height: 65, backgroundColor: "transparent" }}
        onMessage={(event) => {
          try {
            const message = JSON.parse(event.nativeEvent.data) as { type?: string; token?: string };
            if (message.type === "token" && message.token) onToken(message.token);
            else if (message.type === "expired") onToken(null);
            else if (message.type === "error") setFailed(true);
          } catch {
            // Ignore malformed bridge messages.
          }
        }}
        onError={() => {
          setFailed(true);
          onToken(null);
        }}
      />
    </View>
  );
}
