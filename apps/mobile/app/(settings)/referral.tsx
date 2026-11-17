import type { MyReferralCode } from "@rakazo_mickvvw/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CodeCopyButton } from "../../components/code-copy-button";
import { rpc } from "../../lib/api";
import { mobileTokens } from "../../lib/appearance";
import { dateLocaleForUi, useI18n } from "../../lib/i18n";
import { native, useThemedStyles } from "../../lib/native";
import { useSideInsets } from "../../lib/side-insets";
import { errorText } from "../../lib/user-error";

export default function ReferralCodeDetail() {
  const sideInsets = useSideInsets();
  const { t, locale } = useI18n();
  const styles = useThemedStyles(createReferralStyles);
  const [code, setCode] = useState<MyReferralCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setCode(await rpc("referral/code"));
    } catch (err) {
      setLoadError(errorText(err, t("Could not load invite code")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const count = useMemo(() => new Intl.NumberFormat(dateLocaleForUi(locale)), [locale]);
  const exhausted = code?.status === "exhausted" || code?.status === "revoked";
  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView
        style={sideInsets}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        {loading ? (
          <ActivityIndicator color={native.secondaryLabel} />
        ) : loadError ? (
          <View style={styles.centered}>
            <Text accessibilityRole="alert" style={styles.error}>
              {loadError}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void load()}>
              <Text style={styles.retry}>{t("Retry")}</Text>
            </Pressable>
          </View>
        ) : !code ? (
          <View style={styles.centered}>
            <Text style={styles.empty}>{t("Referral codes are not available.")}</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.codeRow}>
              <Text style={styles.code}>{code.code}</Text>
              <CodeCopyButton code={code.code} />
            </View>
            {exhausted ? (
              <Text style={styles.usedUp}>{t("Used up")}</Text>
            ) : (
              <Text style={styles.uses}>
                {t("{used} of {max} uses", {
                  used: count.format(code.usedCount),
                  max: count.format(code.maxUses),
                })}
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createReferralStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: native.groupedPage,
    },
    content: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 32,
      gap: 4,
    },
    centered: {
      alignItems: "center",
      gap: 12,
      paddingTop: 32,
    },
    error: {
      color: tokens.destructive,
      fontSize: 15,
      textAlign: "center",
    },
    retry: {
      color: tokens.link,
      fontSize: 16,
      fontWeight: "600",
    },
    empty: {
      color: tokens.mutedForeground,
      fontSize: 14,
      paddingVertical: 12,
      textAlign: "center",
    },
    card: {
      backgroundColor: tokens.card,
      borderRadius: 20,
      padding: 16,
    },
    codeRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    code: {
      color: tokens.foreground,
      fontSize: 22,
      fontWeight: "700",
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
      letterSpacing: 2,
    },
    uses: {
      color: tokens.mutedForeground,
      fontSize: 14,
      marginTop: 10,
    },
    usedUp: {
      color: tokens.destructive,
      fontSize: 14,
      fontWeight: "700",
      marginTop: 10,
    },
  });
}
