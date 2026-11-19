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
  BOT_PROMPT_PRESET_MAX,
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
import { ChevronDown, ChevronUp, Download, Pencil, Settings, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useState } from "react";
import { thinkingLevelLabel } from "../../lib/model-catalog";
import type { ModelLocateKind } from "../../lib/model-locate";
import type { TranslationSourceLanguage, TranslationTargetLanguage } from "../../lib/translation";
import {
  TRANSLATION_SOURCE_LANGUAGES,
  TRANSLATION_TARGET_LANGUAGES,
  translationLanguageLabel,
} from "../../lib/translation";
import { ChatModelPicker } from "./chat-model-picker";

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
  videoFallbacks,
  onAddVideoFallback,
  onMoveVideoFallback,
  onRemoveVideoFallback,
  videoTest,
  onTestVideoModel,
  onApplyVideoTestedModel,
  imageChoices,
  imageValue,
  onImageModelChange,
  imageFallbacks,
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
  videoEditFallbacks,
  onAddVideoEditFallback,
  onMoveVideoEditFallback,
  onRemoveVideoEditFallback,
  videoEditTest,
  onTestVideoEditModel,
  onApplyVideoEditTestedModel,
  imageEditChoices,
  imageEditValue,
  onImageEditModelChange,
  imageEditFallbacks,
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
  videoFallbacks: readonly MediaModelFallback[];
  onAddVideoFallback: (key: string) => void;
  onMoveVideoFallback: (key: string, delta: -1 | 1) => void;
  onRemoveVideoFallback: (key: string) => void;
  videoTest: MediaModelTestState;
  onTestVideoModel: (key: string) => void;
  onApplyVideoTestedModel: () => void;
  imageChoices: readonly ChatModelChoice[];
  imageValue: string;
  onImageModelChange: (key: string) => void;
  imageFallbacks: readonly MediaModelFallback[];
  onAddImageFallback: (key: string) => void;
  onMoveImageFallback: (key: string, delta: -1 | 1) => void;
  onRemoveImageFallback: (key: string) => void;
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
  videoEditFallbacks: readonly MediaModelFallback[];
  onAddVideoEditFallback: (key: string) => void;
  onMoveVideoEditFallback: (key: string, delta: -1 | 1) => void;
  onRemoveVideoEditFallback: (key: string) => void;
  videoEditTest: MediaModelTestState;
  onTestVideoEditModel: (key: string) => void;
  onApplyVideoEditTestedModel: () => void;
  imageEditChoices: readonly ChatModelChoice[];
  imageEditValue: string;
  onImageEditModelChange: (key: string) => void;
  imageEditFallbacks: readonly MediaModelFallback[];
  onAddImageEditFallback: (key: string) => void;
  onMoveImageEditFallback: (key: string, delta: -1 | 1) => void;
  onRemoveImageEditFallback: (key: string) => void;
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
        fallbacks={videoFallbacks}
        onAddFallback={onAddVideoFallback}
        onMoveFallback={onMoveVideoFallback}
        onRemoveFallback={onRemoveVideoFallback}
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
        fallbacks={imageFallbacks}
        onAddFallback={onAddImageFallback}
        onMoveFallback={onMoveImageFallback}
        onRemoveFallback={onRemoveImageFallback}
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
        modelLabel={t`Video edit model`}
        choices={videoEditChoices}
        value={videoEditValue}
        onModelChange={onVideoEditModelChange}
        fallbacks={videoEditFallbacks}
        onAddFallback={onAddVideoEditFallback}
        onMoveFallback={onMoveVideoEditFallback}
        onRemoveFallback={onRemoveVideoEditFallback}
        test={videoEditTest}
        onTestModel={onTestVideoEditModel}
        onApplyTestedModel={onApplyVideoEditTestedModel}
      />
      <MediaRoleSection
        ids={`${ids}-edit`}
        kind="image"
        modelLabel={t`Image edit model`}
        choices={imageEditChoices}
        value={imageEditValue}
        onModelChange={onImageEditModelChange}
        fallbacks={imageEditFallbacks}
        onAddFallback={onAddImageEditFallback}
        onMoveFallback={onMoveImageEditFallback}
        onRemoveFallback={onRemoveImageEditFallback}
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
  locatedKey,
  locateKind,
  modelLabel,
  choices,
  value,
  onModelChange,
  fallbacks,
  onAddFallback,
  onMoveFallback,
  onRemoveFallback,
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
  /** The model-option key a timeline name pointed at; that row is tagged. */
  locatedKey?: string | null;
  /** Which list a timeline name pointed at; its picker opens on the located row. */
  locateKind?: ModelLocateKind | null;
  modelLabel: string;
  choices: readonly ChatModelChoice[];
  value: string;
  onModelChange: (key: string) => void;
  fallbacks: readonly MediaModelFallback[];
  onAddFallback: (key: string) => void;
  onMoveFallback: (key: string, delta: -1 | 1) => void;
  onRemoveFallback: (key: string) => void;
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
  const usedKeys = new Set([value, ...fallbacks.map((fallback) => fallback.key)]);
  const addChoices = choices.filter((choice) => choice.key !== "" && !usedKeys.has(choice.key));
  // The list is primary-first: the first model added becomes the primary, so
  // the fallback section stays visible even before one is picked.
  const totalModels = (value ? 1 : 0) + fallbacks.length;
  const canAdd = totalModels < BOT_MODEL_LIST_MAX && addChoices.length > 0;
  const primaryTest = test.status === "done" && test.modelKey === value ? test : null;
  const testingPrimary = test.status === "testing" && test.modelKey === value;
  const locatedPrimary = locateKind === kind && (locatedKey == null || locatedKey === value);
  return (
    <>
      <div
        data-model-section={kind}
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
              autoOpen={locateKind === kind}
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
      {fallbacks.length > 0 || canAdd ? (
        <MediaModelFallbackList
          label={t`Fallback models`}
          fallbacks={fallbacks}
          locatedKey={locatedKey}
          addChoices={addChoices}
          canAdd={canAdd}
          onAdd={onAddFallback}
          onMove={onMoveFallback}
          onRemove={onRemoveFallback}
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
  label,
  fallbacks,
  locatedKey,
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
  label: string;
  fallbacks: readonly MediaModelFallback[];
  /** The model-option key a timeline name pointed at; that row is tagged. */
  locatedKey?: string | null;
  addChoices: readonly ChatModelChoice[];
  canAdd: boolean;
  onAdd: (key: string) => void;
  onMove: (key: string, delta: -1 | 1) => void;
  onRemove: (key: string) => void;
  kind: "video" | "image";
  test: MediaModelTestState;
  onTest: (key: string) => void;
  onApplyTestedModel: () => void;
}) {
  const { t } = useLingui();
  return (
    <div>
      <span className={rowLabelClass}>{label}</span>
      <ul className="mt-1 space-y-1">
        {fallbacks.map((fallback, index) => {
          const testing = test.status === "testing" && test.modelKey === fallback.key;
          const tested = test.status === "done" && test.modelKey === fallback.key ? test : null;
          const located =
            locatedKey !== null && locatedKey !== undefined && locatedKey === fallback.key;
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
                <Button
                  variant="outline"
                  size="sm"
                  disabled={testing}
                  onClick={() => onTest(fallback.key)}
                >
                  {testing ? t`Testing…` : t`Test`}
                </Button>
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
              {tested ? (
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
          aria-label={t`Add fallback model`}
          className="mt-1 w-full"
          value=""
          onChange={(event) => {
            if (event.target.value) onAdd(event.target.value);
          }}
        >
          <NativeSelectOption value="">{t`Add fallback model`}</NativeSelectOption>
          {addChoices.map((choice) => (
            <NativeSelectOption key={choice.key} value={choice.key}>
              {choice.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : null}
    </div>
  );
}

/**
 * The prompt presets for one media kind: tap a preset to make it active, edit
 * or delete per row, add a new one. The editor is inline: name plus prompt.
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
  const { t } = useLingui();
  const [editing, setEditing] = useState<{
    originalName: string | null;
    name: string;
    prompt: string;
    error: string | null;
  } | null>(null);

  function saveEditing() {
    if (!editing) return;
    const name = editing.name.trim();
    const prompt = editing.prompt.trim();
    if (!name) {
      setEditing({ ...editing, error: t`Enter a preset name` });
      return;
    }
    if (!prompt) {
      setEditing({ ...editing, error: t`Enter a prompt` });
      return;
    }
    if (presets.some((preset) => preset.name === name && preset.name !== editing.originalName)) {
      setEditing({ ...editing, error: t`A preset with this name already exists` });
      return;
    }
    const next = [...presets];
    const wasActive = editing.originalName !== null && editing.originalName === active;
    if (editing.originalName === null) {
      next.push({ name, prompt });
    } else {
      const index = next.findIndex((preset) => preset.name === editing.originalName);
      if (index === -1) return;
      next[index] = { name, prompt };
    }
    onPresetsChange(next);
    if (wasActive) onActiveChange(name);
    if (editing.originalName === null && next.length === 1) onActiveChange(name);
    setEditing(null);
  }

  return (
    <div>
      <span className={rowLabelClass}>{label}</span>
      <ul className="mt-1 space-y-1">
        {presets.map((preset) => {
          const isActive = active === preset.name;
          return (
            <li key={preset.name} className="flex min-h-9 items-start gap-2">
              <button
                type="button"
                className="min-w-0 flex-1 text-start"
                aria-pressed={isActive}
                onClick={() => onActiveChange(isActive ? null : preset.name)}
              >
                <span
                  className={`block truncate text-body text-foreground ${isActive ? "font-medium" : ""}`}
                >
                  {isActive ? `✓ ${preset.name}` : preset.name}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-body-sm text-muted-foreground">
                  {preset.prompt}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t`Edit preset`}
                onClick={() =>
                  setEditing({
                    originalName: preset.name,
                    name: preset.name,
                    prompt: preset.prompt,
                    error: null,
                  })
                }
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t`Delete preset`}
                onClick={() => {
                  onPresetsChange(presets.filter((entry) => entry.name !== preset.name));
                  if (isActive) onActiveChange(null);
                }}
              >
                <X className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Input
            aria-label={t`Preset name`}
            placeholder={t`Preset name`}
            value={editing.name}
            onChange={(event) => setEditing({ ...editing, name: event.target.value, error: null })}
          />
          <Textarea
            aria-label={t`Preset prompt`}
            placeholder={t`Preset prompt`}
            value={editing.prompt}
            onChange={(event) =>
              setEditing({ ...editing, prompt: event.target.value, error: null })
            }
            rows={3}
          />
          {editing.error ? <p className="text-body-sm text-destructive">{editing.error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button size="sm" onClick={saveEditing}>
              <Trans>Save</Trans>
            </Button>
          </div>
        </div>
      ) : presets.length < BOT_PROMPT_PRESET_MAX ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing({ originalName: null, name: "", prompt: "", error: null })}
        >
          <Trans>New preset</Trans>
        </Button>
      ) : null}
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
