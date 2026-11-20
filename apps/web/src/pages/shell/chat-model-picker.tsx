import { Trans, useLingui } from "@lingui/react/macro";
import type { ChatModelChoice } from "@rakazo_mickvvw/core";
import { groupModelChoices, modelChoiceSearchText } from "@rakazo_mickvvw/core";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  ListSearchInput,
  NativeSelect,
  NativeSelectOption,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@rakazo_mickvvw/ui-web";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { TextOnlyMark } from "../../components/TextOnlyMark";
import { readModelStatus } from "../../lib/model-status";
import { useMedia } from "../../lib/pages";
import { useListSearch } from "../../lib/use-list-search";
import { ModelStatusBadge } from "./model-switch-menu";

/** A chat's model: a native select, or a searchable list once there are too many to scan. */
export function ChatModelPicker({
  id,
  choices,
  value,
  onChange,
  /** The model-option key a timeline name pointed at; that row is tagged. */
  locatedKey,
}: {
  id: string;
  choices: readonly ChatModelChoice[];
  value: string;
  onChange: (key: string) => void;
  locatedKey?: string | null;
}) {
  const { t } = useLingui();
  const imagesHintId = useId();
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  // On a touch device the popover's default initial focus lands on the
  // search input and pops the keyboard; the keyboard only belongs to a
  // tap on the input itself, so coarse pointers open unfocused.
  const coarsePointer = useMedia("(pointer: coarse)");
  // A located row is tagged, and opening the list scrolls to it; a
  // timeline tap never opens the list on its own, so the popover cannot
  // cover the settings panel it jumped to. A located key that is not
  // one of this list's options (a fallback row, or a model that is no
  // longer listed) opens nothing: its tag lives in the section instead.
  useEffect(() => {
    if (!open || !locatedKey) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-located-row="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [open, locatedKey]);
  const { query, setQuery, showSearch, visible } = useListSearch(choices, {
    text: modelChoiceSearchText,
  });
  const sections = useMemo(() => groupModelChoices(visible, ""), [visible]);
  const selected = choices.find((choice) => choice.key === value) ?? choices[0];
  const textOnly = selected?.images === false;
  const imagesHint = <span id={imagesHintId} hidden>{t`Can't read images`}</span>;

  if (!showSearch) {
    return (
      <div className="mt-2 flex items-center gap-2">
        {imagesHint}
        <NativeSelect
          id={id}
          className="w-full"
          aria-describedby={textOnly ? imagesHintId : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {choices.map((choice) => (
            <NativeSelectOption key={choice.key} value={choice.key}>
              {choice.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {textOnly ? (
          <span className="text-muted-foreground">
            <TextOnlyMark />
          </span>
        ) : null}
      </div>
    );
  }

  function openChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      {imagesHint}
      <PopoverTrigger
        id={id}
        aria-describedby={textOnly ? imagesHintId : undefined}
        className="mt-2 flex min-h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-start text-body text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
      >
        <span className="min-w-0 break-words">{selected?.label}</span>
        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
          {textOnly ? <TextOnlyMark /> : null}
          <ChevronDownIcon className="size-4" aria-hidden="true" />
        </span>
      </PopoverTrigger>
      {open ? (
        <PopoverContent
          align="start"
          side="bottom"
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
          initialFocus={coarsePointer ? false : undefined}
          className="w-(--anchor-width) max-h-(--available-height) gap-0 overflow-hidden bg-popover p-0 opacity-100 animate-none! backdrop-filter-none"
        >
          <Command
            shouldFilter={false}
            className="h-auto min-h-0 max-h-(--available-height) rounded-none bg-popover *:data-[slot=command-input-wrapper]:shrink-0"
          >
            <ListSearchInput
              command
              query={query}
              setQuery={setQuery}
              label={t`Search models`}
              placeholder={t`Search`}
            />
            <CommandList ref={listRef} className="min-h-0 max-h-80 flex-1 overflow-y-auto">
              <CommandEmpty>
                <Trans>No matching models</Trans>
              </CommandEmpty>
              {sections.map((section) => (
                <CommandGroup key={section.key} heading={section.heading}>
                  {section.data.map((choice) => (
                    <CommandItem
                      key={choice.key}
                      aria-label={choice.label}
                      // cmdk falls back to the row's text for an empty value.
                      value={choice.key || "space-default"}
                      data-checked={choice.key === value}
                      data-located-row={choice.key === locatedKey}
                      aria-describedby={choice.images === false ? imagesHintId : undefined}
                      onSelect={() => {
                        onChange(choice.key);
                        openChange(false);
                      }}
                    >
                      <span className="min-w-0 flex-1 break-words">
                        {choice.title ?? choice.label}
                      </span>
                      {choice.key === locatedKey ? (
                        <span className="shrink-0 rounded-full border border-link/40 px-2 py-0.5 text-body-sm text-link">
                          <Trans>Located here</Trans>
                        </span>
                      ) : null}
                      <ModelStatusBadge status={readModelStatus(choice.key)} />
                      {choice.images === false ? (
                        <span className="shrink-0 text-muted-foreground">
                          <TextOnlyMark />
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
