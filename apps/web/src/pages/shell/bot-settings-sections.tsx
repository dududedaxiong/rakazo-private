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
import { displayName, parseModelOptionKey } from "@rakazo_mickvvw/core";
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
import { useEffect, useRef, useState } from "react";
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
    <span className="shrink-0 rounded-full border border-link/40 px-2 py-0.5 text-body-sm text-link">
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
  locateRequestId,
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
  /** Which list a timeline name pointed at; that row is tagged. */
  locateKind?: ModelLocateKind | null;
  /** Fresh id of the locate request, so locating the same model twice refocuses. */
  locateRequestId?: number;
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
  // Focus lands on the located row itself, one commit after the panel
  // records the key: the locate popup's dialog returns focus to the thread
  // in the commit where it closes, so focusing in the panel's effect loses
  // to it. The pool lists focus their own rows the same way.
  useEffect(() => {
    if (locateKind !== "chat") return;
    if (locatedKey == null) {
      containerRef.current?.focus();
      return;
    }
    if (locatedKey !== value) return;
    containerRef.current
      ?.querySelector<HTMLElement>("[data-model-row] button, [data-model-row] select")
      ?.focus();
  }, [locateKind, locatedKey, locateRequestId, value, containerRef]);
  return (
    <div ref={containerRef} data-model-section="chat" tabIndex={-1} className="outline-none">
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
      <div className={`rounded-xl bg-muted/50 p-4 space-y-3 ${located ? "ring-2 ring-link" : ""}`}>
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
  mainFallbacks,
  backupFallbacks,
  onAddMainFallback,
  onMoveMainFallback,
  onRemoveMainFallback,
  onReplaceMainFallback,
  onAddBackupFallback,
  onMoveBackupFallback,
  onRemoveBackupFallback,
  onReplaceBackupFallback,
  translationTest,
  onTestTranslationModel,
  onApplyTranslationTestedModel,
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
  /** Which list a timeline name pointed at; that row is tagged. */
  locateKind?: ModelLocateKind | null;
  /** Main-pool models after the primary, in try order. */
  mainFallbacks: readonly MediaModelFallback[];
  /** Backup-pool models, tried only after the main pool is exhausted. */
  backupFallbacks: readonly MediaModelFallback[];
  onAddMainFallback: (key: string) => void;
  onMoveMainFallback: (key: string, delta: -1 | 1) => void;
  onRemoveMainFallback: (key: string) => void;
  onReplaceMainFallback: (oldKey: string, newKey: string) => void;
  onAddBackupFallback: (key: string) => void;
  onMoveBackupFallback: (key: string, delta: -1 | 1) => void;
  onRemoveBackupFallback: (key: string) => void;
  onReplaceBackupFallback: (oldKey: string, newKey: string) => void;
  /** One translation probe: idle until tested, then the inline result. */
  translationTest?: MediaModelTestState;
  onTestTranslationModel?: (key: string) => void;
  onApplyTranslationTestedModel?: () => void;
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
  // listed; the primary is the first card of the main pool below, so a
  // located primary is tagged there, not here.
  const locatedSection = locateKind === "translation" && locatedKey == null;
  // The primary is the first row of the main pool, not a picker above it:
  // the count and the rows finally agree, and the primary gets the same
  // replace, reorder, remove and locate as every other row.
  const mainRows: readonly MediaModelFallback[] = value
    ? [
        {
          key: value,
          label:
            choices.find((choice) => choice.key === value)?.label ??
            parseModelOptionKey(value)?.modelId ??
            value,
        },
        ...mainFallbacks,
      ]
    : mainFallbacks;
  const usedKeys = new Set([
    value,
    ...mainFallbacks.map((fallback) => fallback.key),
    ...backupFallbacks.map((fallback) => fallback.key),
  ]);
  const addChoices = choices.filter((choice) => choice.key !== "" && !usedKeys.has(choice.key));
  const canAddMain = mainRows.length < BOT_MODEL_LIST_MAX && addChoices.length > 0;
  const canAddBackup = backupFallbacks.length < BOT_MODEL_LIST_MAX && addChoices.length > 0;
  return (
    <BotPanelGroup label={t`Translation`}>
      <div
        data-model-section="translation"
        tabIndex={-1}
        className={`flex min-h-11 flex-wrap items-center justify-between gap-3 outline-none ${locatedSection ? "rounded-lg border-2 border-link bg-accent px-2" : "border-2 border-transparent"}`}
      >
        <span className={rowLabelClass}>
          <Trans>Translation model</Trans>
        </span>
        {locatedSection ? <LocatedTag /> : null}
      </div>
      {mainRows.length > 0 || canAddMain ? (
        <MediaModelFallbackList
          pool="main"
          fallbacks={mainRows}
          locatedKey={locatedKey}
          locateKind={locateKind}
          locateSection="translation"
          choices={choices}
          addChoices={addChoices}
          canAdd={canAddMain}
          onAdd={onAddMainFallback}
          onMove={onMoveMainFallback}
          onRemove={onRemoveMainFallback}
          onReplace={onReplaceMainFallback}
          kind="translation"
          test={translationTest}
          onTest={onTestTranslationModel}
          onApplyTestedModel={onApplyTranslationTestedModel}
        />
      ) : null}
      {backupFallbacks.length > 0 || canAddBackup ? (
        <MediaModelFallbackList
          pool="backup"
          fallbacks={backupFallbacks}
          locatedKey={locatedKey}
          locateKind={locateKind}
          locateSection="translation"
          choices={choices}
          addChoices={addChoices}
          canAdd={canAddBackup}
          onAdd={onAddBackupFallback}
          onMove={onMoveBackupFallback}
          onRemove={onRemoveBackupFallback}
          onReplace={onReplaceBackupFallback}
          kind="translation"
          test={translationTest}
          onTest={onTestTranslationModel}
          onApplyTestedModel={onApplyTranslationTestedModel}
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

/** The input modalities a card's model is known to support, from the
 * capability data the card already looks up: the catalog, or the
 * connection's own vision list where the catalog is silent. Text is
 * always in a model's input, image only when one of those says it reads
 * images. A free-form id carries no capability data, so no
 * badge at all — never a guess. Audio and video have no capability field
 * anywhere yet, so that tier stays unwired; see the decision note. */
export type ModelCapability = "text" | "image" | "audioVideo";

function modelCapabilities(choice: ChatModelChoice | undefined): ModelCapability[] {
  if (choice?.images === undefined) return [];
  return choice.images ? ["text", "image"] : ["text"];
}

/**
 * A fallback card's expanded details. Only real data, taken from the
 * fallback's key and the connected choices: the provider, the raw model
 * id, whether the catalog says the model reads images, and the card's
 * pool and position. A row renders only when its value exists — a
 * free-form id the catalog does not know gets no image row at all, never
 * a guess — and there is no usage row: this page carries no per-model
 * usage data.
 */
function FallbackDetails({
  fallback,
  pool,
  index,
  choices,
}: {
  fallback: MediaModelFallback;
  pool: "main" | "backup";
  index: number;
  choices: readonly ChatModelChoice[];
}) {
  const { t } = useLingui();
  const choice = choices.find((candidate) => candidate.key === fallback.key);
  const parsed = parseModelOptionKey(fallback.key);
  const modelId = choice?.modelId ?? parsed?.modelId;
  const provider = choice?.providerLabel ?? parsed?.provider;
  const rows: { label: string; value: string }[] = [];
  if (provider) rows.push({ label: t`Provider`, value: provider });
  if (modelId) rows.push({ label: t`Model ID`, value: modelId });
  if (choice?.images !== undefined)
    rows.push({
      label: t`Image input`,
      value: choice.images ? t`Supported` : t`Not supported`,
    });
  rows.push({
    label: t`Position`,
    value: `${pool === "main" ? t`Main models` : t`Backup pool`} #${index + 1}`,
  });
  return (
    <dl
      data-testid="model-fallback-details"
      className="mt-1.5 space-y-0.5 border-t border-border/60 pt-1.5 text-body-sm"
    >
      {rows.map((row) => (
        <div key={row.label} className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

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
 * as the first card of the main pool, the ordered fallbacks with add,
 * reorder and remove, and the prompt presets with create, edit, delete and
 * activate. Picking a model moves it to the front of that role's list; the rest stay
 * as fallbacks, tried in order.
 */
export function MediaModelGroup({
  ids,
  locatedKey,
  locateKind,
  videoChoices,
  videoValue,
  videoMainFallbacks,
  videoBackupFallbacks,
  onAddVideoFallback,
  onMoveVideoFallback,
  onRemoveVideoFallback,
  onReplaceVideoFallback,
  videoTest,
  onTestVideoModel,
  onApplyVideoTestedModel,
  imageChoices,
  imageValue,
  imageMainFallbacks,
  imageBackupFallbacks,
  onAddImageFallback,
  onMoveImageFallback,
  onRemoveImageFallback,
  onReplaceImageFallback,
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
  videoEditMainFallbacks,
  videoEditBackupFallbacks,
  onAddVideoEditFallback,
  onMoveVideoEditFallback,
  onRemoveVideoEditFallback,
  onReplaceVideoEditFallback,
  videoEditTest,
  onTestVideoEditModel,
  onApplyVideoEditTestedModel,
  imageEditChoices,
  imageEditValue,
  imageEditMainFallbacks,
  imageEditBackupFallbacks,
  onAddImageEditFallback,
  onMoveImageEditFallback,
  onRemoveImageEditFallback,
  onReplaceImageEditFallback,
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
  videoMainFallbacks: readonly MediaModelFallback[];
  videoBackupFallbacks: readonly MediaModelFallback[];
  onAddVideoFallback: (pool: "main" | "backup", key: string) => void;
  onMoveVideoFallback: (pool: "main" | "backup", key: string, delta: -1 | 1) => void;
  onRemoveVideoFallback: (pool: "main" | "backup", key: string) => void;
  onReplaceVideoFallback: (pool: "main" | "backup", oldKey: string, newKey: string) => void;
  videoTest: MediaModelTestState;
  onTestVideoModel: (key: string) => void;
  onApplyVideoTestedModel: () => void;
  imageChoices: readonly ChatModelChoice[];
  imageValue: string;
  imageMainFallbacks: readonly MediaModelFallback[];
  imageBackupFallbacks: readonly MediaModelFallback[];
  onAddImageFallback: (pool: "main" | "backup", key: string) => void;
  onMoveImageFallback: (pool: "main" | "backup", key: string, delta: -1 | 1) => void;
  onRemoveImageFallback: (pool: "main" | "backup", key: string) => void;
  onReplaceImageFallback: (pool: "main" | "backup", oldKey: string, newKey: string) => void;
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
  videoEditMainFallbacks: readonly MediaModelFallback[];
  videoEditBackupFallbacks: readonly MediaModelFallback[];
  onAddVideoEditFallback: (pool: "main" | "backup", key: string) => void;
  onMoveVideoEditFallback: (pool: "main" | "backup", key: string, delta: -1 | 1) => void;
  onRemoveVideoEditFallback: (pool: "main" | "backup", key: string) => void;
  onReplaceVideoEditFallback: (pool: "main" | "backup", oldKey: string, newKey: string) => void;
  videoEditTest: MediaModelTestState;
  onTestVideoEditModel: (key: string) => void;
  onApplyVideoEditTestedModel: () => void;
  imageEditChoices: readonly ChatModelChoice[];
  imageEditValue: string;
  imageEditMainFallbacks: readonly MediaModelFallback[];
  imageEditBackupFallbacks: readonly MediaModelFallback[];
  onAddImageEditFallback: (pool: "main" | "backup", key: string) => void;
  onMoveImageEditFallback: (pool: "main" | "backup", key: string, delta: -1 | 1) => void;
  onRemoveImageEditFallback: (pool: "main" | "backup", key: string) => void;
  onReplaceImageEditFallback: (pool: "main" | "backup", oldKey: string, newKey: string) => void;
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
        mainFallbacks={videoMainFallbacks}
        backupFallbacks={videoBackupFallbacks}
        onAddMainFallback={(key) => onAddVideoFallback("main", key)}
        onMoveMainFallback={(key, delta) => onMoveVideoFallback("main", key, delta)}
        onRemoveMainFallback={(key) => onRemoveVideoFallback("main", key)}
        onReplaceMainFallback={(oldKey, newKey) => onReplaceVideoFallback("main", oldKey, newKey)}
        onAddBackupFallback={(key) => onAddVideoFallback("backup", key)}
        onMoveBackupFallback={(key, delta) => onMoveVideoFallback("backup", key, delta)}
        onRemoveBackupFallback={(key) => onRemoveVideoFallback("backup", key)}
        onReplaceBackupFallback={(oldKey, newKey) =>
          onReplaceVideoFallback("backup", oldKey, newKey)
        }
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
        mainFallbacks={imageMainFallbacks}
        backupFallbacks={imageBackupFallbacks}
        onAddMainFallback={(key) => onAddImageFallback("main", key)}
        onMoveMainFallback={(key, delta) => onMoveImageFallback("main", key, delta)}
        onRemoveMainFallback={(key) => onRemoveImageFallback("main", key)}
        onReplaceMainFallback={(oldKey, newKey) => onReplaceImageFallback("main", oldKey, newKey)}
        onAddBackupFallback={(key) => onAddImageFallback("backup", key)}
        onMoveBackupFallback={(key, delta) => onMoveImageFallback("backup", key, delta)}
        onRemoveBackupFallback={(key) => onRemoveImageFallback("backup", key)}
        onReplaceBackupFallback={(oldKey, newKey) =>
          onReplaceImageFallback("backup", oldKey, newKey)
        }
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
        mainFallbacks={videoEditMainFallbacks}
        backupFallbacks={videoEditBackupFallbacks}
        onAddMainFallback={(key) => onAddVideoEditFallback("main", key)}
        onMoveMainFallback={(key, delta) => onMoveVideoEditFallback("main", key, delta)}
        onRemoveMainFallback={(key) => onRemoveVideoEditFallback("main", key)}
        onReplaceMainFallback={(oldKey, newKey) =>
          onReplaceVideoEditFallback("main", oldKey, newKey)
        }
        onAddBackupFallback={(key) => onAddVideoEditFallback("backup", key)}
        onMoveBackupFallback={(key, delta) => onMoveVideoEditFallback("backup", key, delta)}
        onRemoveBackupFallback={(key) => onRemoveVideoEditFallback("backup", key)}
        onReplaceBackupFallback={(oldKey, newKey) =>
          onReplaceVideoEditFallback("backup", oldKey, newKey)
        }
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
        mainFallbacks={imageEditMainFallbacks}
        backupFallbacks={imageEditBackupFallbacks}
        onAddMainFallback={(key) => onAddImageEditFallback("main", key)}
        onMoveMainFallback={(key, delta) => onMoveImageEditFallback("main", key, delta)}
        onRemoveMainFallback={(key) => onRemoveImageEditFallback("main", key)}
        onReplaceMainFallback={(oldKey, newKey) =>
          onReplaceImageEditFallback("main", oldKey, newKey)
        }
        onAddBackupFallback={(key) => onAddImageEditFallback("backup", key)}
        onMoveBackupFallback={(key, delta) => onMoveImageEditFallback("backup", key, delta)}
        onRemoveBackupFallback={(key) => onRemoveImageEditFallback("backup", key)}
        onReplaceBackupFallback={(oldKey, newKey) =>
          onReplaceImageEditFallback("backup", oldKey, newKey)
        }
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
  mainFallbacks,
  backupFallbacks,
  onAddMainFallback,
  onMoveMainFallback,
  onRemoveMainFallback,
  onReplaceMainFallback,
  onAddBackupFallback,
  onMoveBackupFallback,
  onRemoveBackupFallback,
  onReplaceBackupFallback,
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
  /** Which list a timeline name pointed at; that row is tagged. */
  locateKind?: ModelLocateKind | null;
  modelLabel: string;
  choices: readonly ChatModelChoice[];
  value: string;
  /** Main-pool models after the primary, in try order. */
  mainFallbacks: readonly MediaModelFallback[];
  /** Backup-pool models, tried only after the main pool is exhausted. */
  backupFallbacks: readonly MediaModelFallback[];
  onAddMainFallback: (key: string) => void;
  onMoveMainFallback: (key: string, delta: -1 | 1) => void;
  onRemoveMainFallback: (key: string) => void;
  onReplaceMainFallback: (oldKey: string, newKey: string) => void;
  onAddBackupFallback: (key: string) => void;
  onMoveBackupFallback: (key: string, delta: -1 | 1) => void;
  onRemoveBackupFallback: (key: string) => void;
  onReplaceBackupFallback: (oldKey: string, newKey: string) => void;
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
  // The section itself is the locate target when the model is no longer
  // listed; the primary is the first card of the main pool below, so a
  // located primary is tagged there, not here.
  const locatedSection = locateKind === section && locatedKey == null;
  // The primary is the first row of the main pool, not a picker above it:
  // the count and the rows finally agree, and the primary gets the same
  // replace, test, reorder, remove and locate as every other row. The
  // main pool is primary-first: the first model added becomes the
  // primary, so its section stays visible even before one is picked.
  const mainRows: readonly MediaModelFallback[] = value
    ? [
        {
          key: value,
          label:
            choices.find((choice) => choice.key === value)?.label ??
            parseModelOptionKey(value)?.modelId ??
            value,
        },
        ...mainFallbacks,
      ]
    : mainFallbacks;
  const usedKeys = new Set([
    value,
    ...mainFallbacks.map((fallback) => fallback.key),
    ...backupFallbacks.map((fallback) => fallback.key),
  ]);
  const addChoices = choices.filter((choice) => choice.key !== "" && !usedKeys.has(choice.key));
  const canAddMain = mainRows.length < BOT_MODEL_LIST_MAX && addChoices.length > 0;
  const canAddBackup = backupFallbacks.length < BOT_MODEL_LIST_MAX && addChoices.length > 0;
  return (
    <>
      <div
        data-model-section={section}
        tabIndex={-1}
        className={`flex min-h-11 flex-wrap items-center justify-between gap-3 outline-none ${locatedSection ? "rounded-lg border-2 border-link bg-accent px-2" : "border-2 border-transparent"}`}
      >
        <span className={rowLabelClass}>{modelLabel}</span>
        {locatedSection ? <LocatedTag /> : null}
      </div>
      {mainRows.length > 0 || canAddMain ? (
        <MediaModelFallbackList
          pool="main"
          fallbacks={mainRows}
          locatedKey={locatedKey}
          locateKind={locateKind}
          locateSection={section}
          choices={choices}
          addChoices={addChoices}
          canAdd={canAddMain}
          onAdd={onAddMainFallback}
          onMove={onMoveMainFallback}
          onRemove={onRemoveMainFallback}
          onReplace={onReplaceMainFallback}
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
          choices={choices}
          addChoices={addChoices}
          canAdd={canAddBackup}
          onAdd={onAddBackupFallback}
          onMove={onMoveBackupFallback}
          onRemove={onRemoveBackupFallback}
          onReplace={onReplaceBackupFallback}
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
  kind: "video" | "image" | "translation";
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
            : kind === "image"
              ? t`✓ ${test.modelId} supports image generation · ${test.seconds}s`
              : t`✓ ${test.modelId} supports translation · ${test.seconds}s`
          : kind === "video"
            ? t`✗ Does not support video generation · ${test.detail}`
            : kind === "image"
              ? t`✗ Does not support image generation · ${test.detail}`
              : t`✗ Does not support translation · ${test.detail}`}
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
  fallbacks,
  locatedKey,
  locateKind,
  locateSection,
  choices,
  addChoices,
  canAdd,
  onAdd,
  onMove,
  onRemove,
  onReplace,
  kind,
  test,
  onTest,
  onApplyTestedModel,
}: {
  /** Which pool this list is; the title and the add entry follow it. */
  pool: "main" | "backup";
  fallbacks: readonly MediaModelFallback[];
  /** The model-option key a timeline name pointed at; that row is tagged. */
  locatedKey?: string | null;
  /** Which list a timeline name pointed at; only that list tags its row. */
  locateKind?: ModelLocateKind | null;
  /** The locate anchor of this list; the edit lists anchor apart from generation. */
  locateSection: ModelLocateKind;
  /** Every connected choice, for the expanded details lookup. */
  choices: readonly ChatModelChoice[];
  addChoices: readonly ChatModelChoice[];
  canAdd: boolean;
  onAdd: (key: string) => void;
  onMove: (key: string, delta: -1 | 1) => void;
  onRemove: (key: string) => void;
  /** Swap one row for another model, in place; the rest of the pool is untouched. */
  onReplace: (oldKey: string, newKey: string) => void;
  kind: "video" | "image" | "translation";
  /** One capability probe: idle until tested, then the inline result. */
  test?: MediaModelTestState;
  onTest?: (key: string) => void;
  onApplyTestedModel?: () => void;
}) {
  const { t } = useLingui();
  // A located row inside a folded list unfolds it, so the tag is visible.
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  // One card's details at a time; tapping the same banner closes it again.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  // The main pool starts open: the primary is its first card, so a closed
  // list would hide the model the section is about. The backup pool still
  // starts closed when it has rows, to save room.
  const effectiveOpen = open ?? (pool === "main" || fallbacks.length === 0);
  useEffect(() => {
    if (
      locatedKey &&
      locateKind === locateSection &&
      fallbacks.some((fallback) => fallback.key === locatedKey)
    ) {
      setOpen(true);
    }
  }, [locatedKey, locateKind, locateSection, fallbacks]);
  // A locate lands keyboard focus on the located row's banner button, so
  // the row is the next Tab stop and the focus ring marks it. The list
  // focuses its own row: it knows when it unfolded onto it, and the panel
  // cannot, since the row may not exist yet when the panel scrolls.
  useEffect(() => {
    if (!effectiveOpen || !locatedKey || locateKind !== locateSection) return;
    if (!fallbacks.some((fallback) => fallback.key === locatedKey)) return;
    const row = [...(listRef.current?.querySelectorAll("[data-model-row]") ?? [])].find(
      (node) => node.getAttribute("data-model-row") === locatedKey,
    );
    row?.querySelector<HTMLElement>("button")?.focus();
  }, [effectiveOpen, locatedKey, locateKind, locateSection, fallbacks]);
  return (
    <FallbackDisclosure
      count={fallbacks.length}
      pool={pool}
      defaultOpen={pool === "main" || fallbacks.length === 0}
      open={open}
      onOpenChange={setOpen}
    >
      <ul ref={listRef} className="mt-1 space-y-2">
        {fallbacks.map((fallback, index) => {
          const testing = test?.status === "testing" && test.modelKey === fallback.key;
          const tested = test?.status === "done" && test.modelKey === fallback.key ? test : null;
          const located =
            locateKind === locateSection &&
            locatedKey !== null &&
            locatedKey !== undefined &&
            locatedKey === fallback.key;
          // Capability badges, from the same catalog lookup as the details:
          // only what the catalog knows, nothing guessed.
          const capabilities = modelCapabilities(
            choices.find((candidate) => candidate.key === fallback.key),
          );
          // Every row is a banner card: the full name (with its provider)
          // is the banner header on its own line, the buttons sit below
          // it. A located card adds the colored border on top of that.
          // Replace opens the same picker as the add entry below the
          // list, and leads the buttons: replace, test, up, down, remove.
          const buttons = (
            <>
              {located ? <LocatedTag /> : null}
              {addChoices.length > 0 ? (
                <NativeSelect
                  size="sm"
                  aria-label={t`Replace model`}
                  value=""
                  onChange={(event) => {
                    if (event.target.value) onReplace(fallback.key, event.target.value);
                  }}
                >
                  <NativeSelectOption value="">{t`Replace model`}</NativeSelectOption>
                  {addChoices.map((choice) => (
                    <NativeSelectOption key={choice.key} value={choice.key}>
                      {choice.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : null}
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
                disabled={index === 0}
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
            </>
          );
          return (
            <li key={fallback.key}>
              <div
                data-model-row={fallback.key}
                className={`rounded-lg border-2 px-3 py-2 ${
                  located ? "border-link bg-accent" : "border-transparent bg-muted/50"
                }`}
              >
                <button
                  type="button"
                  aria-expanded={expandedKey === fallback.key}
                  onClick={() => setExpandedKey(expandedKey === fallback.key ? null : fallback.key)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span
                    className="min-w-0 break-words text-body font-medium text-foreground"
                    dir="auto"
                  >
                    {displayName(fallback.label, t`Model`)}
                  </span>
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                      expandedKey === fallback.key ? "rotate-180" : ""
                    }`}
                    aria-hidden="true"
                  />
                </button>
                {expandedKey === fallback.key ? (
                  <FallbackDetails
                    fallback={fallback}
                    pool={pool}
                    index={index}
                    choices={choices}
                  />
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {buttons}
                  {capabilities.map((capability) => (
                    <span
                      key={capability}
                      className="shrink-0 rounded-full border border-border px-2 py-0.5 text-body-sm text-muted-foreground"
                    >
                      {capability === "text"
                        ? t`Text`
                        : capability === "image"
                          ? t`Image`
                          : t`Audio & video`}
                    </span>
                  ))}
                </div>
              </div>
              {tested ? (
                <MediaModelTestResult
                  test={tested}
                  kind={kind}
                  // The main pool's first row already is the primary;
                  // offering to set it as primary would be a no-op.
                  onApplyPrimary={pool === "main" && index === 0 ? undefined : onApplyTestedModel}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {canAdd ? (
        <NativeSelect
          aria-label={pool === "main" ? t`Add main model` : t`Add fallback model`}
          className="mt-1 w-full"
          value=""
          onChange={(event) => {
            if (event.target.value) onAdd(event.target.value);
          }}
        >
          <NativeSelectOption value="">
            {pool === "main" ? t`Add main model` : t`Add fallback model`}
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
