import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";
import { createModelsStyles } from "./model-connection-styles";
import { NativeActionButton } from "./native-action-button";
import { SettingsRow } from "./settings-group";

/** A row that shows or hides the section below it. */
export function DisclosureRow({
  label,
  expanded,
  onPress,
}: {
  label: string;
  expanded: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createModelsStyles);
  return (
    <View style={styles.card}>
      <SettingsRow
        title={label}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        chevron={expanded ? "down" : "right"}
        onPress={onPress}
      />
    </View>
  );
}

/** An API key input with an eye button to reveal the text. */
export function SecretField({
  label,
  value,
  onChangeText,
  placeholder,
  busy,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  busy: boolean;
}) {
  const styles = useThemedStyles(createModelsStyles);
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.secretRow}>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        editable={!busy}
        importantForAutofill="no"
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={native.tertiaryLabel}
        secureTextEntry={!visible}
        style={styles.secretInput}
        textContentType="none"
        value={value}
      />
      <NativeActionButton
        accessibilityLabel={visible ? t("Hide password") : t("Show password")}
        icon={{
          ios: visible ? "eye.slash" : "eye",
          android: visible ? "eye-off-outline" : "eye-outline",
        }}
        prominence="quiet"
        onPress={() => setVisible((shown) => !shown)}
        style={{ alignSelf: "center", minWidth: 44, minHeight: 44, marginRight: 4 }}
      />
    </View>
  );
}

/** A whole-number limit, such as maximum output tokens. */
export function LimitField({
  label,
  value,
  onChangeText,
  maxLength,
  busy,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  maxLength: number;
  busy: boolean;
}) {
  const styles = useThemedStyles(createModelsStyles);
  return (
    <View>
      <Text style={styles.sectionTitle}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!busy}
        keyboardType="number-pad"
        maxLength={maxLength}
        onChangeText={onChangeText}
        style={styles.keyInput}
        value={value}
      />
    </View>
  );
}
