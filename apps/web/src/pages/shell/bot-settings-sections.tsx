import { Trans, useLingui } from "@lingui/react/macro";
import type {
  BotPromptPreset,
  ComputerMode,
  ReplyMode,
  ThinkingLevel,
} from "@rakazo_mickvvw/contracts";
import {
  BOT_COMPUTER_MODES,
  BOT_DESCRIPTION_MAX_LENGTH,
  BOT_MODEL_LIST_MAX,
  BUILTIN_TOOL_NAMES,
  DEFAULT_IMAGE_TRIGGER_WORDS,
  DEFAULT_VIDEO_TRIGGER_WORDS,
} from "@rakazo_mickvvw/contracts";
import type { ChatModelChoice } from "@rakazo_mickvvw/core";
import { displayName } from "@rakazo_mickvvw/core";
import {
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  SectionHeading,
  Switch,
  Textarea,
  Toggle,
} from "@rakazo_mickvvw/ui-web";
import { ChevronDown, ChevronUp, Download, Settings, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useEffect, useState } from "react";
import { thinkingLevelLabel } from "../../lib/model-catalog";
import type { ModelLocateKind } from "../../lib/model-locate";
import type { TranslationSourceLanguage, TranslationTargetLanguage } from "../../lib/translation";
import {
  TRANSLATION_SOURCE_LANGUAGES,
  TRANSLATION_TARGET_LANGUAGES,
  translationLanguageLabel,
} from "../../lib/translation";
import { ChatModelPicker } from "./chat-model-picker";
import { FallbackDisclosure } from "./fallback-disclosure";
import { PromptPresetTags } from "./prompt-preset-tags";

const rowLabelClass = "text-body text-foreground";

/** The "you are here" tag on a model row a timeline name pointed at. */
function LocatedTag() {
  return (
    <span className="shrink-0 rounded-full border border-primary/40 px-2 py-0.5 text-body-sm text-primary">
      <Trans>Located here</Trans>
    </span>
  );
}

type MemoryScope = "isolated" | "shared" | null;

export function ComputerModePicker({
  value,
  onChange,
}: {
  value: ComputerMode;
  onChange: (value: ComputerMode) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {BOT_COMPUTER_MODES.map((mode) => (
        <Toggle
          key={mode}
          variant="outline"
          pressed={value === mode}
          onPressedChange={(pressed) => {
            if (pressed) onChange(mode);
          }}
          className="capitalize aria-pressed:border-foreground/40 aria-pressed:text-foreground"
        >
          {mode === "team" ? <Trans>Team</Trans> : <Trans>Private</Trans>}
        </Toggle>
      ))}
    </div>
  );
}

/** `plain` drops the card for a section whose single control already draws its own frame. */
function BotPanelGroup({
  label,
  plain = false,
  children,
}: {
  label: string;
  plain?: boolean;
  children: ReactNode;
}) {
  return (
    <section>
      <SectionHeading variant="label" className="mb-2">
        {label}
      </SectionHeading>
      <div className={`space-y-3 [&>*]:mt-0 ${plain ? "" : "rounded-xl bg-muted/50 p-4"}`}>
        {children}
      </div>
    </section>
  );
}

function humanizeTool(name: string) {
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function NotificationsSection({
  ids,
  notifyOnFinish,
  onNotifyOnFinishChange,
}: {
  ids: string;
  notifyOnFinish: boolean;
  onNotifyOnFinishChange: (checked: boolean) => void;
}) {
  return (
    <section className="mt-6">
      <SectionHeading variant="label" className="mb-2">
        <Trans>Notifications</Trans>
      </SectionHeading>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-4">
        <div>
          <label
            htmlFor={`${ids}-notify-finish`}
            id={`${ids}-notify-finish-label`}
            className="text-body"
          >
            <Trans>When it finishes or needs input</Trans>
          </label>
        </div>
        <Switch
          id={`${ids}-notify-finish`}
          checked={notifyOnFinish}
          aria-labelledby={`${ids}-notify-finish-label`}
          onCheckedChange={onNotifyOnFinishChange}
        />
      </div>
    </section>
  );
}

/** The model picker and, when the model offers levels, its thinking level. */
export function ModelSection({
  ids,
  containerRef,
  onOpenConnections,
  choices,
  value,
  locatedKey,
  locateKind,
  onModelChange,
  thinkingOptions,
  thinkingLevel,
  defaultThinkingLevel,
  onThinkingLevelChange,
}: {
  ids: string;
  containerRef: RefObject<HTMLDivElement | null>;
  onOpenConnections?: () => void;
  choices: readonly ChatModelChoice[];
  value: string;
  /** The model-option key a timeline name pointed at; that row is tagged. */
  locatedKey?: string | null;
  /** Which list a timeline name pointed at; its picker opens on the located row. */
  locateKind?: ModelLocateKind | null;
  onModelChange: (key: string) => void;
  thinkingOptions: ThinkingLevel[];
  thinkingLevel: string;
  defaultThinkingLevel: ThinkingLevel;
  onThinkingLevelChange: (level: string) => void;
}) {
  const { t } = useLingui();
  // The section itself is the locate target when the model is no longer
  // listed: the timeline pointed here, so the section still carries the tag.
  const located = locateKind === "chat" && (locatedKey == null || locatedKey === value);
  return (
    <div ref={containerRef} data-model-section="chat">
      <div className="mb-2 flex items-center justify-between text-label font-medium text-muted-foreground pe-1">
        <Trans>Model</Trans>
        {located ? <LocatedTag /> : null}
        {onOpenConnections ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t`Model connections`}
            onClick={onOpenConnections}
          >
            <Settings className="size-4" />
          </Button>
        ) : null}
      </div>
      <div
        className={`rounded-xl bg-muted/50 p-4 space-y-3 ${located ? "ring-1 ring-primary/40" : ""}`}
      >
        <div data-model-row={value} className="flex min-h-11 items-center justify-between gap-3">
          <label htmlFor={`${ids}-model`} className="sr-only">
            <Trans>Model</Trans>
          </label>
          <div className="min-w-0 w-full [&>div]:mt-0 [&>button]:mt-0">
            <ChatModelPicker
              id={`${ids}-model`}
              choices={choices}
              value={value}
              locatedKey={locatedKey}
              autoOpen={locateKind === "chat"}
              onChange={onModelChange}
            />
          </div>
        </div>
        {thinkingOptions.length ? (
          <label
            htmlFor={`${ids}-thinking`}
            className="flex min-h-11 items-center justify-between gap-3 text-body text-foreground"
          >
            <Trans>Thinking</Trans>
            <NativeSelect
              id={`${ids}-thinking`}
              className="max-w-2/3"
              value={thinkingLevel}
              onChange={(event) => onThinkingLevelChange(event.target.value)}
            >
              <NativeSelectOption value="">
                {t`Default (${thinkingLevelLabel(defaultThinkingLevel)})`}
              </NativeSelectOption>
              {thinkingOptions.map((level) => (
                <NativeSelectOption key={level} value={level}>
                  {thinkingLevelLabel(level)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        ) : null}
      </div>
    </div>
  );
}

export function ComputerGroup({
  computerMode,
  onComputerModeChange,
  memoryProviderConfigured,
  memoryScope,
  onMemoryScopeChange,
}: {
  computerMode: ComputerMode;
  onComputerModeChange: (mode: ComputerMode) => void;
  memoryProviderConfigured: boolean;
  memoryScope: MemoryScope;
  onMemoryScopeChange: (scope: MemoryScope) => void;
}) {
  const { t } = useLingui();
  return (
    <BotPanelGroup label={t`Computer`} plain>
      <ComputerModePicker value={computerMode} onChange={onComputerModeChange} />
      {memoryProviderConfigured ? (
        <div className="mt-4 text-body text-foreground">
          <Trans>Memory scope</Trans>
          <div className="mt-2 flex gap-2">
            {(
              [
                { value: null, label: t`Inherit default` },
                { value: "isolated" as const, label: t`Isolated` },
                { value: "shared" as const, label: t`Shared` },
              ] satisfies Array<{ value: "isolated" | "shared" | null; label: string }>
            ).map((option) => (
              <Toggle
                key={option.label}
                variant="outline"
                size="sm"
                pressed={memoryScope === option.value}
                onPressedChange={(pressed) => {
                  if (pressed) onMemoryScopeChange(option.value);
                }}
                className="flex-1 aria-pressed:border-foreground/40 aria-pressed:text-foreground"
              >
                {option.label}
              </Toggle>
            ))}
          </div>
        </div>
      ) : null}
    </BotPanelGroup>
  );
}

export function VoiceGroup({
  ids,
  autoSpeak,
  onAutoSpeakChange,
  voices,
  voiceId,
  onVoiceIdChange,
}: {
  ids: string;
  autoSpeak: boolean;
  onAutoSpeakChange: (checked: boolean) => void;
  voices: ReadonlyArray<{ id: string; label: string }> | undefined;
  voiceId: string;
  onVoiceIdChange: (voiceId: string) => void;
}) {
  const { t } = useLingui();
  return (
    <BotPanelGroup label={t`Voice`}>
      <label
        htmlFor={`${ids}-auto-speak`}
        className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-body text-foreground"
      >
        <span className={rowLabelClass}>
          <Trans>Read replies aloud</Trans>
        </span>
        <Switch
          id={`${ids}-auto-speak`}
          checked={autoSpeak}
          onCheckedChange={(checked) => onAutoSpeakChange(checked)}
        />
      </label>
      {voices?.length ? (
        <label
          htmlFor={`${ids}-voice`}
          className="flex min-h-11 items-center justify-between gap-3 text-body text-foreground"
        >
          <Trans>Voice</Trans>
          <NativeSelect
            id={`${ids}-voice`}
            className="max-w-2/3"
            value={voiceId}
            onChange={(event) => onVoiceIdChange(event.target.value)}
          >
            <NativeSelectOption value="">{t`Account default`}</NativeSelectOption>
            {voices.map((voice) => (
              <NativeSelectOption key={voice.id} value={voice.id}>
                {voice.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      ) : null}
    </BotPanelGroup>
  );
}

export function TranslationGroup({
  ids,
  choices,
  value,
  locatedKey,
  locateKind,
  onModelChange,
  mainFallbacks,
  backupFallbacks,
  onAddMainFallback,
  onMoveMainFallback,
  onRemoveMainFallback,
  onAddBackupFallback,
  onMoveBackupFallback,
  onRemoveBackupFallback,
  sourceLanguage,
  onSourceLanguageChange,
  targetLanguage,
  onTargetLanguageChange,
  autoTranslate,
  onAutoTranslateChange,
  showTranslationActions,
  onShowTranslationActionsChange,
}: {
  ids: string;
  choices: readonly ChatModelChoice[];
  value: string;
  /** The model-option key a timeline name pointed at; that row is tagged. */
  locatedKey?: string | null;
  /** Which list a timeline name pointed at; its picker opens on the located row. */
  locateKind?: ModelLocateKind | null;
  onModelChange: (key: string) => void;
  /** Main-pool models after the primary, in try order. */
  mainFallbacks: readonly MediaModelFallback[];
  /** Backup-pool models, tried only after the main pool is exhausted. */
  backupFallbacks: readonly MediaModelFallback[];
  onAddMainFallback: (key: string) => void;
  onMoveMainFallback: (key: string, delta: -1 | 1) => void;
  onRemoveMainFallback: (key: string) => void;
  onAddBackupFallback: (key: string) => void;
  onMoveBackupFallback: (key: string, delta: -1 | 1) => void;
  onRemoveBackupFallback: (key: string) => void;
  sourceLanguage: TranslationSourceLanguage;
  onSourceLanguageChange: (language: TranslationSourceLanguage) => void;
  targetLanguage: TranslationTargetLanguage;
  onTargetLanguageChange: (language: TranslationTargetLanguage) => void;
  autoTranslate: boolean;
  onAutoTranslateChange: (checked: boolean) => void;
  showTranslationActions: boolean;
  onShowTranslationActionsChange: (checked: boolean) => void;
}) {
  const { t } = useLingui();
  // The section itself is the locate target when the model is no longer
  // listed: the timeline pointed here, so the section still carries the tag.
  const located = locateKind === "translation" && (locatedKey == null || locatedKey === value);
  const usedKeys = new Set([
    value,
    ...mainFallbacks.map((fallback) => fallback.key),
    ...backupFallbacks.map((fallback) => fallback.key),
  ]);
  const addChoices = choices.filter((choice) => choice.key !== "" && !usedKeys.has(choice.key));
  const mainTotal = (value ? 1 : 0) + mainFallbacks.length;
  const canAddMain = mainTotal < BOT_MODEL_LIST_MAX && addChoices.length > 0;
  const canAddBackup = backupFallbacks.length < BOT_MODEL_LIST_MAX && addChoices.length > 0;
  return (
    <BotPanelGroup label={t`Translation`}>
      <div
        data-model-section="translation"
        data-model-row={value}
        className={`flex min-h-11 items-center justify-between gap-3 ${located ? "rounded-lg bg-accent px-2" : ""}`}
      >
        <label htmlFor={`${ids}-translation-model`} className={rowLabelClass}>
          <Trans>Translation model</Trans>
        </label>
        <div className="min-w-0 w-full max-w-2/3 [&>div]:mt-0 [&>button]:mt-0">
          <ChatModelPicker
            id={`${ids}-translation-model`}
            choices={choices}
            value={value}
            locatedKey={locatedKey}
            autoOpen={locateKind === "translation"}
            onChange={onModelChange}
          />
        </div>
        {located ? <LocatedTag /> : null}
      </div>
      {mainFallbacks.length > 0 || canAddMain ? (
        <MediaModelFallbackList
          pool="main"
          poolSize={mainTotal}
          fallbacks={mainFallbacks}
          locatedKey={locatedKey}
          locateKind={locateKind}
          locateSection="translation"
          addChoices={addChoices}
          canAdd={canAddMain}
          onAdd={onAddMainFallback}
          onMove={onMoveMainFallback}
          onRemove={onRemoveMainFallback}
          kind="translation"
        />
      ) : null}
      {backupFallbacks.length > 0 || canAddBackup ? (
        <MediaModelFallbackList
          pool="backup"
          fallbacks={backupFallbacks}
          locatedKey={locatedKey}
          locateKind={locateKind}
          locateSection="translation"
          addChoices={addChoices}
          canAdd={canAddBackup}
          onAdd={onAddBackupFallback}
          onMove={onMoveBackupFallback}
          onRemove={onRemoveBackupFallback}
          kind="translation"
        />
      ) : null}
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className={rowLabelClass}>
          <Trans>Source language</Trans>
        </span>
        <fieldset
          className="m-0 flex flex-wrap justify-end gap-2 border-0 p-0"
          aria-label={t`Source language`}
        >
          {TRANSLATION_SOURCE_LANGUAGES.map((language) => (
            <Toggle
              key={language}
              variant="outline"
              size="sm"
              pressed={sourceLanguage === language}
              onPressedChange={(pressed) => {
                if (pressed) onSourceLanguageChange(language);
              }}
              className="aria-pressed:border-foreground/40 aria-pressed:text-foreground"
            >
              {translationLanguageLabel(language)}
            </Toggle>
          ))}
        </fieldset>
      </div>
      <label
        htmlFor={`${ids}-translation-target`}
        className="flex min-h-11 items-center justify-between gap-3 text-body text-foreground"
      >
        <Trans>Target language</Trans>
        <NativeSelect
          id={`${ids}-translation-target`}
          className="max-w-2/3"
          value={targetLanguage}
          onChange={(event) =>
            onTargetLanguageChange(event.target.value as TranslationTargetLanguage)
          }
        >
          {TRANSLATION_TARGET_LANGUAGES.map((language) => (
            <NativeSelectOption key={language} value={language}>
              {translationLanguageLabel(language)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label
        htmlFor={`${ids}-auto-translate`}
        className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-body text-foreground"
      >
        <span className={rowLabelClass}>
          <Trans>Auto-translate replies</Trans>
        </span>
        <Switch
          id={`${ids}-auto-translate`}
          checked={autoTranslate}
          onCheckedChange={onAutoTranslateChange}
        />
      </label>
      <label
        htmlFor={`${ids}-show-translation-actions`}
        className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-body text-foreground"
      >
        <span className={rowLabelClass}>
          <Trans>Show read-aloud, share, and favorite on translations</Trans>
        </span>
        <Switch
          id={`${ids}-show-translation-actions`}
          checked={showTranslationActions}
          onCheckedChange={onShowTranslationActionsChange}
        />
      </label>
    </BotPanelGroup>
  );
}

export type MediaModelFallback = {
  key: string;
  label: string;
};

/** One media-capability probe: idle until tested, then the inline result. */
export type MediaModelTestState =
  | { status: "idle" }
  | { status: "testing"; modelKey: string }
  | {
      status: "done";
      supported: boolean;
      seconds: number;
      detail: string;
      modelKey: string;
      modelId: string;
    };

/**
 * A bot's image and video generation models, one block per role: the primary
 * picker with a test button, the ordered fallbacks with add, reorder and
 * remove, and the prompt presets with create, edit, delete and activate.
 * Picking a model moves it to the front of that role's list; the rest stay
 * as fallbacks, tried in order.
 */
export function MediaModelGroup({
  ids,
  locatedKey,
  locateKind,
  videoChoices,
  videoValue,
  onVideoModelChange,
  videoMainFallbacks,
  videoBackupFallbacks,
  onAddVideoFallback,
  onMoveVideoFallback,
  onRemoveVideoFallback,
  videoTest,
  onTestVideoModel,
  onApplyVideoTestedModel,
  imageChoices,
  imageValue,
  onImageModelChange,
  imageMainFallbacks,
  imageBackupFallbacks,
  onAddImageFallback,
  onMoveImageFallback,
  onRemoveImageFallback,
  imageTest,
  onTestImageModel,
  onApplyImageTestedModel,
  videoPresets,
  onVideoPresetsChange,
  activeVideoPreset,
  onVideoPresetChange,
  imagePresets,
  onImagePresetsChange,
  activeImagePreset,
  onImagePresetChange,
  videoTriggerWords,
  onVideoTriggerWordsChange,
  imageTriggerWords,
  onImageTriggerWordsChange,
  videoEditChoices,
  videoEditValue,
  onVideoEditModelChange,
  videoEditMainFallbacks,
  videoEditBackupFallbacks,
  onAddVideoEditFallback,
  onMoveVideoEditFallback,
  onRemoveVideoEditFallback,
  videoEditTest,
  onTestVideoEditModel,
  onApplyVideoEditTestedModel,
  imageEditChoices,
  imageEditValue,
  onImageEditModelChange,
  imageEditMainFallbacks,
  imageEditBackupFallbacks,
  onAddImageEditFallback,
  onMoveImageEditFallback,
  onRemoveImageEditFallback,
  imageEditTest,
  onTestImageEditModel,
  onApplyImageEditTestedModel,
}: {
  ids: string;
  /** The model-option key a timeline name pointed at; that row is tagged. */
  locatedKey?: string | null;
  /** Which list a timeline name pointed at; its picker opens on the located row. */
  locateKind?: ModelLocateKind | null;
  videoChoices: readonly ChatModelChoice[];
  videoValue: string;
  onVideoModelChange: (key: string) => void;
  videoMainFallbacks: readonly MediaModelFallback[];
  videoBackupFallbacks: readonly MediaModelFallback[];
  onAddVideoFallback: (pool: "main" | "backup", key: string) => void;
  onMoveVideoFallback: (pool: "main" | "backup", key: string, delta: -1 | 1) => void;
  onRemoveVideoFallback: (pool: "main" | "backup", key: string) => void;
  videoTest: MediaModelTestState;
  onTestVideoModel: (key: string) => void;
  onApplyVideoTestedModel: () => void;
  imageChoices: readonly ChatModelChoice[];
  imageValue: string;
  onImageModelChange: (key: string) => void;
  imageMainFallbacks: readonly MediaModelFallback[];
  imageBackupFallbacks: readonly MediaModelFallback[];
  onAddImageFallback: (pool: "main" | "backup", key: string) => void;
  onMoveImageFallback: (pool: "main" | "backup", key: string, delta: -1 | 1) => void;
  onRemoveImageFallback: (pool: "main" | "backup", key: string) => void;
  imageTest: MediaModelTestState;
  onTestImageModel: (key: string) => void;
  onApplyImageTestedModel: () => void;
  videoPresets: readonly BotPromptPreset[];
  onVideoPresetsChange: (presets: BotPromptPreset[]) => void;
  activeVideoPreset: string | null;
  onVideoPresetChange: (name: string | null) => void;
  imagePresets: readonly BotPromptPreset[];
  onImagePresetsChange: (presets: BotPromptPreset[]) => void;
  activeImagePreset: string | null;
  onImagePresetChange: (name: string | null) => void;
  /** Stored "|" trigger words; empty means the defaults. */
  videoTriggerWords: string;
  onVideoTriggerWordsChange: (value: string) => void;
  /** Stored "|" trigger words; empty means the defaults. */
  imageTriggerWords: string;
  onImageTriggerWordsChange: (value: string) => void;
  /** The edit lists: picker, ordered fallbacks and test only. An edit never applies a preset or trigger words, so those sections are absent. */
  videoEditChoices: readonly ChatModelChoice[];
  videoEditValue: string;
  onVideoEditModelChange: (key: string) => void;
  videoEditMainFallbacks: readonly MediaModelFallback[];
  videoEditBackupFallbacks: readonly MediaModelFallback[];
  onAddVideoEditFallback: (pool: "main" | "backup", key: string) => void;
  onMoveVideoEditFallback: (pool: "main" | "backup", key: string, delta: -1 | 1) => void;
  onRemoveVideoEditFallback: (pool: "main" | "backup", key: string) => void;
  videoEditTest: MediaModelTestState;
  onTestVideoEditModel: (key: string) => void;
  onApplyVideoEditTestedModel: () => void;
  imageEditChoices: readonly ChatModelChoice[];
  imageEditValue: string;
  onImageEditModelChange: (key: string) => void;
  imageEditMainFallbacks: readonly MediaModelFallback[];
  imageEditBackupFallbacks: readonly MediaModelFallback[];
  onAddImageEditFallback: (pool: "main" | "backup", key: string) => void;
  onMoveImageEditFallback: (pool: "main" | "backup", key: string, delta: -1 | 1) => void;
  onRemoveImageEditFallback: (pool: "main" | "backup", key: string) => void;
  imageEditTest: MediaModelTestState;
  onTestImageEditModel: (key: string) => void;
  onApplyImageEditTestedModel: () => void;
}) {
  const { t } = useLingui();
  return (
    <BotPanelGroup label={t`Media model`}>
      <MediaRoleSection
        ids={ids}
        kind="video"
        locatedKey={locatedKey}
        locateKind={locateKind}
        modelLabel={t`Video generation model`}
        choices={videoChoices}
        value={videoValue}
        onModelChange={onVideoModelChange}
        mainFallbacks={videoMainFallbacks}
        backupFallbacks={videoBackupFallbacks}
        onAddMainFallback={(key) => onAddVideoFallback("main", key)}
        onMoveMainFallback={(key, delta) => onMoveVideoFallback("main", key, delta)}
        onRemoveMainFallback={(key) => onRemoveVideoFallback("main", key)}
        onAddBackupFallback={(key) => onAddVideoFallback("backup", key)}
        onMoveBackupFallback={(key, delta) => onMoveVideoFallback("backup", key, delta)}
        onRemoveBackupFallback={(key) => onRemoveVideoFallback("backup", key)}
        test={videoTest}
        onTestModel={onTestVideoModel}
        onApplyTestedModel={onApplyVideoTestedModel}
        presetsLabel={t`Video prompt preset`}
        presets={videoPresets}
        onPresetsChange={onVideoPresetsChange}
        activePreset={activeVideoPreset}
        onPresetChange={onVideoPresetChange}
        triggerWordsLabel={t`Video trigger words`}
        triggerWords={videoTriggerWords}
        onTriggerWordsChange={onVideoTriggerWordsChange}
        triggerWordsPlaceholder={DEFAULT_VIDEO_TRIGGER_WORDS}
      />
      <MediaRoleSection
        ids={ids}
        kind="image"
        locatedKey={locatedKey}
        locateKind={locateKind}
        modelLabel={t`Image generation model`}
        choices={imageChoices}
        value={imageValue}
        onModelChange={onImageModelChange}
        mainFallbacks={imageMainFallbacks}
        backupFallbacks={imageBackupFallbacks}
        onAddMainFallback={(key) => onAddImageFallback("main", key)}
        onMoveMainFallback={(key, delta) => onMoveImageFallback("main", key, delta)}
        onRemoveMainFallback={(key) => onRemoveImageFallback("main", key)}
        onAddBackupFallback={(key) => onAddImageFallback("backup", key)}
        onMoveBackupFallback={(key, delta) => onMoveImageFallback("backup", key, delta)}
        onRemoveBackupFallback={(key) => onRemoveImageFallback("backup", key)}
        test={imageTest}
        onTestModel={onTestImageModel}
        onApplyTestedModel={onApplyImageTestedModel}
        presetsLabel={t`Image prompt preset`}
        presets={imagePresets}
        onPresetsChange={onImagePresetsChange}
        activePreset={activeImagePreset}
        onPresetChange={onImagePresetChange}
        triggerWordsLabel={t`Image trigger words`}
        triggerWords={imageTriggerWords}
        onTriggerWordsChange={onImageTriggerWordsChange}
        triggerWordsPlaceholder={DEFAULT_IMAGE_TRIGGER_WORDS}
      />
      <MediaRoleSection
        ids={`${ids}-edit`}
        kind="video"
        section="videoEdit"
        locatedKey={locatedKey}
        locateKind={locateKind}
        modelLabel={t`Video edit model`}
        choices={videoEditChoices}
        value={videoEditValue}
        onModelChange={onVideoEditModelChange}
        mainFallbacks={videoEditMainFallbacks}
        backupFallbacks={videoEditBackupFallbacks}
        onAddMainFallback={(key) => onAddVideoEditFallback("main", key)}
        onMoveMainFallback={(key, delta) => onMoveVideoEditFallback("main", key, delta)}
        onRemoveMainFallback={(key) => onRemoveVideoEditFallback("main", key)}
        onAddBackupFallback={(key) => onAddVideoEditFallback("backup", key)}
        onMoveBackupFallback={(key, delta) => onMoveVideoEditFallback("backup", key, delta)}
        onRemoveBackupFallback={(key) => onRemoveVideoEditFallback("backup", key)}
        test={videoEditTest}
        onTestModel={onTestVideoEditModel}
        onApplyTestedModel={onApplyVideoEditTestedModel}
      />
      <MediaRoleSection
        ids={`${ids}-edit`}
        kind="image"
        section="imageEdit"
        locatedKey={locatedKey}
        locateKind={locateKind}
        modelLabel={t`Image edit model`}
        choices={imageEditChoices}
        value={imageEditValue}
        onModelChange={onImageEditModelChange}
        mainFallbacks={imageEditMainFallbacks}
        backupFallbacks={imageEditBackupFallbacks}
        onAddMainFallback={(key) => onAddImageEditFallback("main", key)}
        onMoveMainFallback={(key, delta) => onMoveImageEditFallback("main", key, delta)}
        onRemoveMainFallback={(key) => onRemoveImageEditFallback("main", key)}
        onAddBackupFallback={(key) => onAddImageEditFallback("backup", key)}
        onMoveBackupFallback={(key, delta) => onMoveImageEditFallback("backup", key, delta)}
        onRemoveBackupFallback={(key) => onRemoveImageEditFallback("backup", key)}
        test={imageEditTest}
        onTestModel={onTestImageEditModel}
        onApplyTestedModel={onApplyImageEditTestedModel}
      />
    </BotPanelGroup>
  );
}

function MediaRoleSection({
  ids,
  kind,
  section = kind,
  locatedKey,
  locateKind,
  modelLabel,
  choices,
  value,
  onModelChange,
  mainFallbacks,
  backupFallbacks,
  onAddMainFallback,
  onMoveMainFallback,
  onRemoveMainFallback,
  onAddBackupFallback,
  onMoveBackupFallback,
  onRemoveBackupFallback,
  test,
  onTestModel,
  onApplyTestedModel,
  presetsLabel,
  presets,
  onPresetsChange,
  activePreset,
  onPresetChange,
  triggerWordsLabel,
  triggerWords,
  onTriggerWordsChange,
  triggerWordsPlaceholder,
}: {
  ids: string;
  kind: "video" | "image";
  /** The locate anchor for this list; the edit lists anchor apart from their generation lists. */
  section?: ModelLocateKind;
  /** The model-option key a timeline name pointed at; that row is tagged. */
  locatedKey?: string | null;
  /** Which list a timeline name pointed at; its picker opens on the located row. */
  locateKind?: ModelLocateKind | null;
  modelLabel: string;
  choices: readonly ChatModelChoice[];
  value: string;
  onModelChange: (key: string) => void;
  /** Main-pool models after the primary, in try order. */
  mainFallbacks: readonly MediaModelFallback[];
  /** Backup-pool models, tried only after the main pool is exhausted. */
  backupFallbacks: readonly MediaModelFallback[];
  onAddMainFallback: (key: string) => void;
  onMoveMainFallback: (key: string, delta: -1 | 1) => void;
  onRemoveMainFallback: (key: string) => void;
  onAddBackupFallback: (key: string) => void;
  onMoveBackupFallback: (key: string, delta: -1 | 1) => void;
  onRemoveBackupFallback: (key: string) => void;
  test: MediaModelTestState;
  onTestModel: (key: string) => void;
  onApplyTestedModel: () => void;
  /** Absent for the edit lists: an edit never applies a preset or trigger words. */
  presetsLabel?: string;
  presets?: readonly BotPromptPreset[];
  onPresetsChange?: (presets: BotPromptPreset[]) => void;
  activePreset?: string | null;
  onPresetChange?: (name: string | null) => void;
  triggerWordsLabel?: string;
  /** Stored "|" trigger words; empty means the defaults. */
  triggerWords?: string;
  onTriggerWordsChange?: (value: string) => void;
  triggerWordsPlaceholder?: string;
}) {
  const { t } = useLingui();
  const usedKeys = new Set([
    value,
    ...mainFallbacks.map((fallback) => fallback.key),
    ...backupFallbacks.map((fallback) => fallback.key),
  ]);
  const addChoices = choices.filter((choice) => choice.key !== "" && !usedKeys.has(choice.key));
  // The main pool is primary-first: the first model added becomes the
  // primary, so its section stays visible even before one is picked.
  const mainTotal = (value ? 1 : 0) + mainFallbacks.length;
  const canAddMain = mainTotal < BOT_MODEL_LIST_MAX && addChoices.length > 0;
  const canAddBackup = backupFallbacks.length < BOT_MODEL_LIST_MAX && addChoices.length > 0;
  const primaryTest = test.status === "done" && test.modelKey === value ? test : null;
  const testingPrimary = test.status === "testing" && test.modelKey === value;
  const locatedPrimary = locateKind === section && (locatedKey == null || locatedKey === value);
  return (
    <>
      <div
        data-model-section={section}
        data-model-row={value}
        className={`flex min-h-11 items-center justify-between gap-3 ${locatedPrimary ? "rounded-lg bg-accent px-2" : ""}`}
      >
        <label htmlFor={`${ids}-${kind}-model`} className={rowLabelClass}>
          {modelLabel}
        </label>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0 flex-1 [&>div]:mt-0 [&>button]:mt-0">
            <ChatModelPicker
              id={`${ids}-${kind}-model`}
              choices={choices}
              value={value}
              locatedKey={locatedKey}
              autoOpen={locateKind === section}
              onChange={onModelChange}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!value || testingPrimary}
            onClick={() => onTestModel(value)}
          >
            {testingPrimary ? t`Testing…` : t`Test`}
          </Button>
          {locatedPrimary ? <LocatedTag /> : null}
        </div>
      </div>
      {primaryTest ? <MediaModelTestResult test={primaryTest} kind={kind} /> : null}
      {mainFallbacks.length > 0 || canAddMain ? (
        <MediaModelFallbackList
          pool="main"
          poolSize={mainTotal}
          fallbacks={mainFallbacks}
          locatedKey={locatedKey}
          locateKind={locateKind}
          locateSection={section}
          addChoices={addChoices}
          canAdd={canAddMain}
          onAdd={onAddMainFallback}
          onMove={onMoveMainFallback}
          onRemove={onRemoveMainFallback}
          kind={kind}
          test={test}
          onTest={onTestModel}
          onApplyTestedModel={onApplyTestedModel}
        />
      ) : null}
      {backupFallbacks.length > 0 || canAddBackup ? (
        <MediaModelFallbackList
          pool="backup"
          fallbacks={backupFallbacks}
          locatedKey={locatedKey}
          locateKind={locateKind}
          locateSection={section}
          addChoices={addChoices}
          canAdd={canAddBackup}
          onAdd={onAddBackupFallback}
          onMove={onMoveBackupFallback}
          onRemove={onRemoveBackupFallback}
          kind={kind}
          test={test}
          onTest={onTestModel}
          onApplyTestedModel={onApplyTestedModel}
        />
      ) : null}
      {presets && presetsLabel && onPresetsChange && onPresetChange ? (
        <>
          <PromptPresetSection
            label={presetsLabel}
            presets={presets}
            active={activePreset ?? null}
            onPresetsChange={onPresetsChange}
            onActiveChange={onPresetChange}
          />
          {triggerWords !== undefined && triggerWordsLabel && onTriggerWordsChange ? (
            <div className="flex min-h-11 items-center justify-between gap-3">
              <label htmlFor={`${ids}-${kind}-trigger-words`} className={rowLabelClass}>
                {triggerWordsLabel}
              </label>
              <Input
                id={`${ids}-${kind}-trigger-words`}
                value={triggerWords}
                placeholder={triggerWordsPlaceholder}
                onChange={(event) => onTriggerWordsChange(event.target.value)}
                className="min-w-0 flex-1"
                aria-label={triggerWordsLabel}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function MediaModelTestResult({
  test,
  kind,
  onApplyPrimary,
}: {
  test: Extract<MediaModelTestState, { status: "done" }>;
  kind: "video" | "image";
  /** Shown when the tested model supports the kind and is not already primary. */
  onApplyPrimary?: () => void;
}) {
  const { t } = useLingui();
  return (
    <div>
      <p className={test.supported ? "text-body-sm text-success" : "text-body-sm text-destructive"}>
        {test.supported
          ? kind === "video"
            ? t`✓ ${test.modelId} supports video generation · ${test.seconds}s`
            : t`✓ ${test.modelId} supports image generation · ${test.seconds}s`
          : kind === "video"
            ? t`✗ Does not support video generation · ${test.detail}`
            : t`✗ Does not support image generation · ${test.detail}`}
      </p>
      {test.supported && onApplyPrimary ? (
        <Button variant="link" size="sm" className="px-0" onClick={onApplyPrimary}>
          <Trans>Set as primary</Trans>
        </Button>
      ) : null}
    </div>
  );
}

function MediaModelFallbackList({
  pool,
  poolSize,
  fallbacks,
  locatedKey,
  locateKind,
  locateSection,
  addChoices,
  canAdd,
  onAdd,
  onMove,
  onRemove,
  kind,
  test,
  onTest,
  onApplyTestedModel,
}: {
  /** Which pool this list is; the title and the add entry follow it. */
  pool: "main" | "backup";
  /** Models in the whole pool; the main pool's primary row is not in `fallbacks`. */
  poolSize?: number;
  fallbacks: readonly MediaModelFallback[];
  /** The model-option key a timeline name pointed at; that row is tagged. */
  locatedKey?: string | null;
  /** Which list a timeline name pointed at; only that list tags its row. */
  locateKind?: ModelLocateKind | null;
  /** The locate anchor of this list; the edit lists anchor apart from generation. */
  locateSection: ModelLocateKind;
  addChoices: readonly ChatModelChoice[];
  canAdd: boolean;
  onAdd: (key: string) => void;
  onMove: (key: string, delta: -1 | 1) => void;
  onRemove: (key: string) => void;
  kind: "video" | "image" | "translation";
  /** Absent for translation: there is no capability probe, so no Test button. */
  test?: MediaModelTestState;
  onTest?: (key: string) => void;
  onApplyTestedModel?: () => void;
}) {
  const { t } = useLingui();
  // A located row inside a folded list unfolds it, so the tag is visible.
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (
      locatedKey &&
      locateKind === locateSection &&
      fallbacks.some((fallback) => fallback.key === locatedKey)
    ) {
      setOpen(true);
    }
  }, [locatedKey, locateKind, locateSection, fallbacks]);
  return (
    <FallbackDisclosure
      count={poolSize ?? fallbacks.length}
      pool={pool}
      defaultOpen={fallbacks.length === 0}
      open={open}
      onOpenChange={setOpen}
    >
      <ul className="mt-1 space-y-1">
        {fallbacks.map((fallback, index) => {
          const testing = test?.status === "testing" && test.modelKey === fallback.key;
          const tested = test?.status === "done" && test.modelKey === fallback.key ? test : null;
          const located =
            locateKind === locateSection &&
            locatedKey !== null &&
            locatedKey !== undefined &&
            locatedKey === fallback.key;
          return (
            <li key={fallback.key}>
              <div
                data-model-row={fallback.key}
                className={`flex min-h-9 items-center gap-2 ${located ? "rounded-lg bg-accent px-2" : ""}`}
              >
                <span
                  className="min-w-0 flex-1 truncate text-body text-muted-foreground"
                  dir="auto"
                >
                  {displayName(fallback.label, t`Model`)}
                </span>
                {located ? <LocatedTag /> : null}
                {onTest ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={testing}
                    onClick={() => onTest(fallback.key)}
                  >
                    {testing ? t`Testing…` : t`Test`}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t`Move fallback model up`}
                  onClick={() => onMove(fallback.key, -1)}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t`Move fallback model down`}
                  disabled={index === fallbacks.length - 1}
                  onClick={() => onMove(fallback.key, 1)}
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t`Remove fallback model`}
                  onClick={() => onRemove(fallback.key)}
                >
                  <X className="size-4" />
                </Button>
              </div>
              {tested && kind !== "translation" ? (
                <MediaModelTestResult
                  test={tested}
                  kind={kind}
                  onApplyPrimary={onApplyTestedModel}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {canAdd ? (
        <NativeSelect
          aria-label={pool === "main" ? t`Add main pool model` : t`Add fallback model`}
          className="mt-1 w-full"
          value=""
          onChange={(event) => {
            if (event.target.value) onAdd(event.target.value);
          }}
        >
          <NativeSelectOption value="">
            {pool === "main" ? t`Add main pool model` : t`Add fallback model`}
          </NativeSelectOption>
          {addChoices.map((choice) => (
            <NativeSelectOption key={choice.key} value={choice.key}>
              {choice.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : null}
    </FallbackDisclosure>
  );
}

/**
 * The prompt presets for one media kind, as a tag row: tap a tag to make it
 * active and open its editor; "+" adds one. The dialog shows the full
 * prompt with rename, edit and delete; saving applies at once.
 */
function PromptPresetSection({
  label,
  presets,
  active,
  onPresetsChange,
  onActiveChange,
}: {
  label: string;
  presets: readonly BotPromptPreset[];
  active: string | null;
  onPresetsChange: (presets: BotPromptPreset[]) => void;
  onActiveChange: (name: string | null) => void;
}) {
  return (
    <div>
      <span className={rowLabelClass}>{label}</span>
      <div className="mt-1">
        <PromptPresetTags
          presets={presets}
          active={active}
          onPresetsChange={onPresetsChange}
          onActiveChange={onActiveChange}
        />
      </div>
    </div>
  );
}

export function PermissionsGroup({
  ids,
  saving,
  dailyCheckIns,
  onDailyCheckInsChange,
  crossSpaceCommunication,
  onCrossSpaceCommunicationChange,
  fleetManagement,
  onFleetManagementChange,
}: {
  ids: string;
  saving: boolean;
  dailyCheckIns: boolean;
  onDailyCheckInsChange: (checked: boolean) => void;
  crossSpaceCommunication: boolean;
  onCrossSpaceCommunicationChange: (checked: boolean) => void;
  fleetManagement: boolean;
  onFleetManagementChange: (checked: boolean) => void;
}) {
  const { t } = useLingui();
  return (
    <BotPanelGroup label={t`Permissions`}>
      <div className="flex min-h-11 items-center justify-between gap-3 text-body">
        <label htmlFor={`${ids}-daily-check-ins`} className={rowLabelClass}>
          <Trans>Daily check-ins on unfinished work</Trans>
        </label>
        <Switch
          id={`${ids}-daily-check-ins`}
          checked={dailyCheckIns}
          disabled={saving}
          onCheckedChange={onDailyCheckInsChange}
        />
      </div>
      <div className="flex min-h-11 items-center justify-between gap-3 text-body">
        <label htmlFor={`${ids}-cross-space`} className={rowLabelClass}>
          <Trans>Allow cross-space bot communication</Trans>
        </label>
        <Switch
          id={`${ids}-cross-space`}
          checked={crossSpaceCommunication}
          disabled={saving}
          onCheckedChange={onCrossSpaceCommunicationChange}
        />
      </div>
      <div className="flex min-h-11 items-center justify-between gap-3 text-body">
        <label htmlFor={`${ids}-fleet-management`} className={rowLabelClass}>
          <Trans>Manage other bots</Trans>
        </label>
        <Switch
          id={`${ids}-fleet-management`}
          checked={fleetManagement}
          disabled={saving}
          onCheckedChange={onFleetManagementChange}
        />
      </div>
    </BotPanelGroup>
  );
}

export function RepliesGroup({
  ids,
  saving,
  replyMode,
  onReplyModeChange,
}: {
  ids: string;
  saving: boolean;
  replyMode: ReplyMode;
  onReplyModeChange: (mode: ReplyMode) => void;
}) {
  const { t } = useLingui();
  return (
    <BotPanelGroup label={t`Replies`} plain>
      <NativeSelect
        id={`${ids}-reply-mode`}
        aria-label={t`Replies`}
        className="w-full"
        value={replyMode}
        disabled={saving}
        onChange={(event) => onReplyModeChange(event.target.value as ReplyMode)}
      >
        <NativeSelectOption value="chat">{t`Chat`}</NativeSelectOption>
        <NativeSelectOption value="messages">{t`Messages`}</NativeSelectOption>
      </NativeSelect>
    </BotPanelGroup>
  );
}

export function DescriptionGroup({
  ids,
  description,
  onDescriptionChange,
  onCommit,
}: {
  ids: string;
  description: string;
  onDescriptionChange: (description: string) => void;
  /** Saves the description when the field loses focus. */
  onCommit: () => void;
}) {
  const { t } = useLingui();
  return (
    <BotPanelGroup label={t`How other bots see it`} plain>
      <Textarea
        id={`${ids}-description`}
        aria-label={t`How other bots see it`}
        value={description}
        maxLength={BOT_DESCRIPTION_MAX_LENGTH}
        onChange={(e) => onDescriptionChange(e.target.value)}
        onBlur={onCommit}
        placeholder={t`What this bot is for`}
        rows={2}
        className="min-h-16 max-h-96 resize-none field-sizing-content"
      />
    </BotPanelGroup>
  );
}

export function ToolsGroup({
  ids,
  disabledBuiltinTools,
  onDisable,
  onEnable,
}: {
  ids: string;
  disabledBuiltinTools: string[];
  onDisable: (name: string) => void;
  onEnable: (name: string) => void;
}) {
  const { t } = useLingui();
  return (
    <BotPanelGroup label={t`Tools`} plain>
      <section data-testid="bot-settings-tools">
        <div className="space-y-2 [&>*]:mt-0">
          <div>
            <NativeSelect
              id={`${ids}-disabled-tools`}
              aria-label={t`Disable a tool`}
              value=""
              onChange={(event) => onDisable(event.target.value)}
              className="w-full"
            >
              <NativeSelectOption value="">{t`Disable a tool`}</NativeSelectOption>
              {BUILTIN_TOOL_NAMES.filter((name) => !disabledBuiltinTools.includes(name)).map(
                (name) => (
                  <NativeSelectOption key={name} value={name}>
                    {humanizeTool(name)}
                  </NativeSelectOption>
                ),
              )}
            </NativeSelect>
          </div>
          {disabledBuiltinTools.map((toolName) => (
            <div
              key={toolName}
              className="flex min-h-11 items-center justify-between gap-3 text-body"
            >
              <span>{humanizeTool(toolName)}</span>
              <Button
                id={`${ids}-disabled-${toolName}`}
                variant="ghost"
                size="icon-xs"
                aria-label={t`Enable ${humanizeTool(toolName)}`}
                title={t`Enable ${humanizeTool(toolName)}`}
                onClick={() => onEnable(toolName)}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </section>
    </BotPanelGroup>
  );
}

export function ExportAndClear({
  onExport,
  onClear,
}: {
  onExport: () => void;
  onClear: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-muted/50 px-4">
      <button
        type="button"
        className="flex min-h-12 w-full items-center justify-between text-body"
        onClick={onExport}
      >
        <Trans>Export</Trans>
        <Download className="size-4 text-muted-foreground" />
      </button>
      <button
        type="button"
        className="min-h-12 w-full border-t border-border text-start text-body text-destructive"
        onClick={onClear}
      >
        <Trans>Clear conversation</Trans>
      </button>
    </div>
  );
}
