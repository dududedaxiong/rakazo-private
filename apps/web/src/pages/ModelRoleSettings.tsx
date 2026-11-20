import { Trans, useLingui } from "@lingui/react/macro";
import type {
  ModelBackupChoice,
  ModelCredential,
  ModelRole,
  ModelRoleChoice,
  ModelRoleSettings as ModelRoleSettingsValue,
  SettingsScope,
  ThinkingLevel,
} from "@rakazo_mickvvw/contracts";
import {
  canonicalPiProviderId,
  connectedBackupOptions,
  MAX_MODEL_BACKUPS,
  modelRoleChoiceKey,
} from "@rakazo_mickvvw/contracts";
import { createModelRoleSettings, sameModelId } from "@rakazo_mickvvw/core";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  SectionHeading,
  Spinner,
} from "@rakazo_mickvvw/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, MoreHorizontal, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { thinkingLevelLabel } from "../lib/model-catalog";
import { spaceQueries } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";
import type { ConnectableProvider, RoleModelOption } from "./model-settings/role-model-picker";
import { RoleModelPicker } from "./model-settings/role-model-picker";
import { FallbackDisclosure } from "./shell/fallback-disclosure";

export type ModelRoleConnectIntent = {
  /** Only the main role's empty first slot takes the new connection's model on connect. */
  makeDefault: boolean;
  onConnected: (choice: ModelRoleChoice) => Promise<void>;
};

type Props = {
  userId: string;
  spaceId: string;
  /** The account's list, or the Space's own when it overrides models. */
  scope: SettingsScope;
  credentials: ModelCredential[];
  modelRole?: ModelRole;
  title: string;
  /** What runs when the first slot is empty. */
  defaultLabel: string;
  providers: ConnectableProvider[];
  /** Connection-aware names, such as "Claude subscription" or a compatible server's host. */
  providerLabel: (provider: string) => string;
  onConnect: (provider: ConnectableProvider, intent: ModelRoleConnectIntent) => void;
  /** Opens one connection's dialog. */
  onManage: (provider: string, credentialId: string) => void;
  /** Offer effort for the first row when its model can think. */
  thinking?: boolean;
  onChanged?: () => void;
  /** The connection form, when it was opened from this list. */
  panel?: ReactNode;
  /** Sits at the end of the heading row. */
  headerAction?: ReactNode;
  /** Extra items in the first row's menu. */
  primaryMenuItems?: ReactNode;
  /** A computer timeline's model: its row is highlighted and scrolled to. */
  locatedModel?: { model: string; provider?: string; requestId?: number } | null;
};

const sameChoice = (left: ModelRoleChoice, right: ModelRoleChoice) =>
  modelRoleChoiceKey(left) === modelRoleChoiceKey(right);

/**
 * A role's two pools: the explicit fields when present, otherwise the
 * primary/backups split, so lists saved before the pools existed keep
 * their primary and their fallbacks.
 */
function rolePools(settings: ModelRoleSettingsValue): {
  main: ModelRoleChoice[];
  backup: ModelRoleChoice[];
} {
  const pools = settings as Partial<ModelRoleSettingsValue>;
  return {
    main: pools.mainPool ?? (settings.primary ? [settings.primary] : []),
    backup: pools.backupPool ?? settings.backups,
  };
}

/** A pool save, with the legacy primary/backups kept in step for older clients. */
type ModelRolePoolPatch = Partial<ModelRoleSettingsValue> & {
  mainPool?: ModelRoleChoice[];
  backupPool?: ModelRoleChoice[];
};
/** A choice compared whole, effort included, so a thinking change counts. */
const sameChoiceDeep = (left: ModelRoleChoice, right: ModelRoleChoice) =>
  left.provider === right.provider &&
  left.modelId === right.modelId &&
  (left.credentialId ?? null) === (right.credentialId ?? null) &&
  (left.thinkingLevel ?? null) === (right.thinkingLevel ?? null);
/**
 * The pools go out whole on every save; the primary only when it changed,
 * so adding a fallback never rewrites the untouched main model.
 */
const poolPatch = (
  main: ModelRoleChoice[],
  backup: ModelRoleChoice[],
  current: ModelRoleSettingsValue,
): ModelRolePoolPatch => {
  const primary = main[0] ?? null;
  const patch: ModelRolePoolPatch = { backups: backup, mainPool: main, backupPool: backup };
  if (
    (primary === null) !== (current.primary === null) ||
    (primary !== null && current.primary !== null && !sameChoiceDeep(primary, current.primary))
  ) {
    patch.primary = primary;
  }
  return patch;
};

const choiceOf = (option: RoleModelOption): ModelRoleChoice => ({
  provider: option.provider,
  modelId: option.id,
  ...(option.credentialId ? { credentialId: option.credentialId } : {}),
});

/** One role's saved list, read through the same cache entry its settings list keeps fresh. */
export function useModelRole(
  account: { userId: string; spaceId: string } | null,
  scope: SettingsScope,
  role: ModelRole,
) {
  const rpc = useSpaceRpc();
  const userId = account?.userId ?? "";
  const spaceId = account?.spaceId ?? "";
  const input = { role, expectedUserId: userId, scope };
  return useQuery({
    queryKey: spaceQueries(userId, spaceId).models.role.queryKey({ input }),
    queryFn: () => rpc.models.role(input, { context: { spaceId } }),
    enabled: Boolean(account),
  }).data;
}

/** One ordered list per model purpose: the first row runs, the rest take over in order. */
export function ModelRoleSettings({
  userId,
  spaceId,
  scope,
  credentials,
  modelRole: role = "main",
  title,
  defaultLabel,
  providers,
  providerLabel,
  onConnect,
  onManage,
  thinking,
  onChanged,
  panel,
  headerAction,
  primaryMenuItems,
  locatedModel,
}: Props) {
  const rpc = useSpaceRpc();
  const queryClient = useQueryClient();
  const { t } = useLingui();
  const controller = useMemo(() => {
    // The last load is cached per user, space, scope, and role, so a revisit shows it while
    // refreshing. Which models a role can use does not depend on the scope.
    const queries = spaceQueries(userId, spaceId);
    const catalogInput = { role, expectedUserId: userId };
    const input = { ...catalogInput, scope };
    const settingsKey = queries.models.role.queryKey({ input });
    const catalogKey = queries.models.forRole.queryKey({ input: catalogInput });
    const settings = queryClient.getQueryData(settingsKey);
    const catalog = queryClient.getQueryData(catalogKey);
    return createModelRoleSettings(
      {
        load: () =>
          queryClient.fetchQuery({
            queryKey: settingsKey,
            queryFn: () => rpc.models.role(input, { context: { spaceId } }),
            staleTime: 0,
          }),
        catalog: () =>
          queryClient.fetchQuery({
            queryKey: catalogKey,
            queryFn: () => rpc.models.forRole(catalogInput, { context: { spaceId } }),
            staleTime: 0,
          }),
        save: async (patch) => {
          const saved = await rpc.models.setRole({ ...input, ...patch }, { context: { spaceId } });
          queryClient.setQueryData(settingsKey, saved);
          return saved;
        },
      },
      JSON.stringify([window.location.origin, userId, spaceId, scope, role]),
      settings && catalog ? { settings, catalog } : undefined,
    );
  }, [queryClient, rpc, userId, spaceId, scope, role]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [dragging, setDragging] = useState<number | null>(null);
  // After a connection the slot's picker reopens on that provider's models.
  const [reopen, setReopen] = useState<{
    slot: "primary" | number | "addMain" | "addBackup";
    query: string;
    key: number;
  } | null>(null);
  useEffect(() => {
    void controller.load();
  }, [controller, credentials]);

  const settings = state.settings;
  const pools = settings ? rolePools(settings) : { main: [], backup: [] };
  const mainPool = pools.main;
  const backupPool = pools.backup;
  const primary = mainPool[0] ?? null;
  const rows = [...mainPool, ...backupPool];
  const entryFor = (choice: ModelBackupChoice) =>
    state.catalog.find(
      (entry) =>
        canonicalPiProviderId(entry.provider) === canonicalPiProviderId(choice.provider) &&
        entry.id === choice.modelId,
    );
  const thinkingLevels =
    thinking && primary
      ? (entryFor(primary)?.thinkingLevels ?? []).filter((level) => level !== "off")
      : [];
  // Grouped by the connection that runs them.
  const options: RoleModelOption[] = connectedBackupOptions(
    state.catalog,
    credentials,
    role === "computer",
  ).map((choice) => ({
    ...(entryFor(choice) ?? {
      provider: choice.provider,
      id: choice.modelId,
      label: choice.label,
      billing: "",
    }),
    providerName: choice.credentialId ? choice.connectionName : providerLabel(choice.provider),
    ...(choice.credentialId ? { credentialId: choice.credentialId } : {}),
  }));
  // A pinned row runs on its connection; others on the provider's newest.
  const connectionFor = (choice: ModelRoleChoice) =>
    choice.credentialId
      ? credentials.find((entry) => entry.id === choice.credentialId)
      : credentials.find(
          (entry) =>
            canonicalPiProviderId(entry.provider) === canonicalPiProviderId(choice.provider),
        );
  const providerName = (choice: ModelRoleChoice) =>
    (choice.credentialId &&
      options.find((option) => option.credentialId === choice.credentialId)?.providerName) ||
    providerLabel(choice.provider);
  // What runs when the member chose no first model; named in the empty row and offered to
  // return to from the picker.
  const deployment = settings?.deploymentPrimary ?? null;
  const modelLabel = (choice: ModelBackupChoice) => entryFor(choice)?.label ?? choice.modelId;
  const busy = state.busy || state.stale || !settings;
  // Picks build their change from the settings loaded when they save, so a reload in flight
  // does not lock them; moves and removals use the rows on screen and wait for it.
  const pickerLocked = state.stale || !settings;

  async function save(update: (current: ModelRoleSettingsValue) => ModelRolePoolPatch) {
    await controller.save(update);
    onChanged?.();
  }
  // The first row is the primary; moving a fallback there promotes it. When the primary
  // goes, the next fallback takes over, or the deployment's default runs.
  const commitPools = (main: ModelRoleChoice[], backup: ModelRoleChoice[]) =>
    save((current) => poolPatch(main, backup, current));
  const canMove = (index: number, target: number) =>
    target >= 0 && target < rows.length && target !== index;
  // A replaced row is found by its model in the loaded list, since a reload may reorder it.
  const place = (pool: "main" | "backup", slot: ModelRoleChoice | "add", choice: ModelRoleChoice) =>
    save((current) => {
      const pools = rolePools(current);
      const list = pool === "main" ? pools.main : pools.backup;
      // A pick made from rows that were still catching up may already be in the loaded
      // list; it keeps its place rather than moving and displacing the main model.
      if ([...pools.main, ...pools.backup].some((item) => sameChoice(item, choice))) return {};
      const at = slot === "add" ? -1 : list.findIndex((item) => sameChoice(item, slot));
      const next =
        at < 0 ? [...list, choice] : list.map((item, index) => (index === at ? choice : item));
      return pool === "main"
        ? poolPatch(next, pools.backup, current)
        : poolPatch(pools.main, next, current);
    });
  const setThinking = (level: ThinkingLevel | null) =>
    save((current) => {
      const pools = rolePools(current);
      return poolPatch(
        pools.main.map((item, index) => (index === 0 ? { ...item, thinkingLevel: level } : item)),
        pools.backup,
        current,
      );
    });
  const setPrimary = (choice: ModelRoleChoice | null) =>
    save((current) => {
      const pools = rolePools(current);
      if (!choice) {
        // Dropping the primary demotes the rest of the main pool to backups,
        // so no model is lost; the deployment default runs instead.
        return poolPatch([], [...pools.main.slice(1), ...pools.backup], current);
      }
      return poolPatch(
        [choice, ...pools.main.filter((item) => !sameChoice(item, choice))],
        pools.backup.filter((item) => !sameChoice(item, choice)),
        current,
      );
    });
  const move = (index: number, target: number) => {
    if (!canMove(index, target)) return;
    const next = [...rows];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    // Pool sizes stay put: a move across the boundary swaps membership.
    void commitPools(next.slice(0, mainPool.length), next.slice(mainPool.length));
  };
  const remove = (index: number) => {
    const next = rows.filter((_, item) => item !== index);
    // Removing the primary promotes the first backup; removing any other row
    // shrinks its own pool instead.
    const mainCount =
      index === 0 ? mainPool.length : mainPool.length - (index < mainPool.length ? 1 : 0);
    void commitPools(next.slice(0, mainCount), next.slice(mainCount));
  };
  const connectFor =
    (slot: "primary" | number | "addMain" | "addBackup") => (provider: ConnectableProvider) =>
      onConnect(provider, {
        makeDefault: role === "main" && slot === "primary" && !primary,
        onConnected: async (choice) => {
          await controller.load();
          onChanged?.();
          setReopen({ slot, query: providerName(choice), key: Date.now() });
        },
      });
  const reopenFor = (slot: "primary" | number | "addMain" | "addBackup") =>
    reopen?.slot === slot ? { query: reopen.query, key: reopen.key } : undefined;

  const canAddMain = Boolean(primary) && mainPool.length < MAX_MODEL_BACKUPS;
  const canAddBackup = backupPool.length < MAX_MODEL_BACKUPS;
  // Order only means something once there is more than one row.
  const ordered = rows.length + (primary ? 0 : 1) > 1;
  const rowClass = `flex min-h-[52px] items-center gap-2.5 py-2 pe-2 ${ordered ? "ps-2" : "ps-3"}`;
  const number = (index: number) => (
    <span className="grid size-5 shrink-0 place-items-center rounded-md bg-accent text-label text-muted-foreground">
      {index + 1}
    </span>
  );
  const pickerTrigger = (label: string, sub?: string) => (
    <button
      type="button"
      className="flex min-w-0 flex-1 items-baseline gap-2 rounded-md py-1 text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="truncate text-body-lg text-foreground">{label}</span>
      {sub ? <span className="truncate text-body-sm text-muted-foreground">{sub}</span> : null}
    </button>
  );

  // The row a computer timeline pointed at, by model id plus the connection
  // display name; without a connection the first row for that model wins.
  const locatedRowIndex = (() => {
    if (!locatedModel) return null;
    const byConnection = rows.findIndex(
      (choice) =>
        sameModelId(choice.modelId, locatedModel.model) &&
        (!locatedModel.provider || providerName(choice) === locatedModel.provider),
    );
    if (byConnection !== -1) return byConnection;
    const byModel = rows.findIndex((choice) => sameModelId(choice.modelId, locatedModel.model));
    return byModel === -1 ? null : byModel;
  })();
  // Each pool folds shut by default; a locate onto a folded row unfolds its pool.
  const [mainOpen, setMainOpen] = useState<boolean | undefined>(undefined);
  const [backupsOpen, setBackupsOpen] = useState<boolean | undefined>(undefined);
  const locatedIsMainExtra =
    locatedRowIndex !== null && locatedRowIndex > 0 && locatedRowIndex < mainPool.length;
  const locatedIsBackup = locatedRowIndex !== null && locatedRowIndex >= mainPool.length;
  useEffect(() => {
    if (locatedRowIndex === null || locatedModel?.requestId === undefined) return;
    if (locatedIsMainExtra) setMainOpen(true);
    if (locatedIsBackup) setBackupsOpen(true);
    const offset = primary ? 0 : 1;
    document
      .querySelector(`[data-testid="model-role-row-${locatedRowIndex + offset + 1}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [
    locatedRowIndex,
    locatedIsMainExtra,
    locatedIsBackup,
    locatedModel?.requestId,
    primary,
    mainOpen,
    backupsOpen,
  ]);

  const optionsLabel = (name: string) => t`${name} options`;

  /** One list row: the primary, or a backup that can move up and down. */
  const renderRow = (choice: ModelRoleChoice, index: number) => {
    const isPrimary = Boolean(primary) && index === 0;
    const name = modelLabel(choice);
    const offset = primary ? 0 : 1;
    const connection = connectionFor(choice);
    return (
      <li
        key={modelRoleChoiceKey(choice)}
        className={`${rowClass} ${dragging === index ? "opacity-50" : ""} ${locatedRowIndex === index ? "bg-accent" : ""}`}
        data-testid={`model-role-row-${index + offset + 1}`}
        draggable={rows.length > 1 && !busy}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          setDragging(index);
        }}
        onDragEnd={() => setDragging(null)}
        onDragOver={(event) => {
          if (dragging !== null) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (dragging !== null) move(dragging, index);
          setDragging(null);
        }}
      >
        {ordered ? (
          <>
            <GripVertical
              aria-hidden
              className={`size-3.5 shrink-0 text-muted-foreground/60 ${rows.length > 1 ? "cursor-grab" : "invisible"}`}
            />
            {number(index + offset)}
          </>
        ) : null}
        <RoleModelPicker
          trigger={pickerTrigger(name, providerName(choice))}
          label={t`Change ${name}`}
          options={options}
          defaultOption={
            isPrimary && role !== "main" && deployment ? modelLabel(deployment) : undefined
          }
          providers={providers}
          disabled={pickerLocked}
          onPick={(option) =>
            option
              ? void (isPrimary
                  ? setPrimary(choiceOf(option))
                  : place(index < mainPool.length ? "main" : "backup", choice, choiceOf(option)))
              : void setPrimary(null)
          }
          onConnect={connectFor(isPrimary ? "primary" : index)}
          reopen={reopenFor(isPrimary ? "primary" : index)}
          onReopened={() => setReopen(null)}
        />
        {isPrimary && thinkingLevels.length && choice.thinkingLevel ? (
          <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-body-sm text-muted-foreground">
            <Trans>Thinking: {thinkingLevelLabel(choice.thinkingLevel)}</Trans>
          </span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground"
                aria-label={optionsLabel(name)}
                disabled={busy}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            {isPrimary && thinkingLevels.length ? (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Trans>Thinking</Trans>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={choice.thinkingLevel ?? ""}
                      onValueChange={(value) =>
                        void setThinking((value || null) as ThinkingLevel | null)
                      }
                    >
                      <DropdownMenuRadioItem value="">
                        <Trans>Default</Trans>
                      </DropdownMenuRadioItem>
                      {thinkingLevels.map((level) => (
                        <DropdownMenuRadioItem key={level} value={level}>
                          {thinkingLevelLabel(level)}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
              </>
            ) : null}
            {rows.length > 1 ? (
              <>
                <DropdownMenuItem
                  disabled={!canMove(index, index - 1)}
                  onClick={() => move(index, index - 1)}
                >
                  <Trans>Move up</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canMove(index, index + 1)}
                  onClick={() => move(index, index + 1)}
                >
                  <Trans>Move down</Trans>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            {isPrimary && primaryMenuItems ? (
              <>
                {primaryMenuItems}
                <DropdownMenuSeparator />
              </>
            ) : null}
            {connection ? (
              <DropdownMenuItem onClick={() => onManage(connection.provider, connection.id)}>
                <Trans>Manage {providerName(choice)}</Trans>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem variant="destructive" onClick={() => remove(index)}>
              <Trans>Remove</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  };

  return (
    <section className="mb-8" data-testid={`model-role-${role}`}>
      <div className="mb-2.5 flex min-h-7 items-center justify-between gap-3">
        <SectionHeading variant="heading">{title}</SectionHeading>
        {headerAction}
      </div>
      <ol className="divide-y divide-border rounded-xl border border-border">
        {primary ? null : (
          <li className={`${rowClass} ${ordered ? "ps-8" : ""}`} data-testid="model-role-default">
            {ordered ? number(0) : null}
            <RoleModelPicker
              trigger={pickerTrigger(
                deployment ? modelLabel(deployment) : defaultLabel,
                deployment ? providerName(deployment) : undefined,
              )}
              label={t`Change ${title}`}
              options={options}
              providers={providers}
              disabled={pickerLocked}
              onPick={(option) => (option ? void setPrimary(choiceOf(option)) : null)}
              onConnect={connectFor("primary")}
              reopen={reopenFor("primary")}
              onReopened={() => setReopen(null)}
            />
            {deployment && primaryMenuItems ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground"
                      aria-label={optionsLabel(modelLabel(deployment))}
                      disabled={busy}
                    />
                  }
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[200px]">
                  {primaryMenuItems}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </li>
        )}
        {primary ? renderRow(mainPool[0]!, 0) : null}
        {mainPool.length > 1 ? (
          <li>
            <FallbackDisclosure
              count={mainPool.length}
              pool="main"
              open={mainOpen}
              onOpenChange={setMainOpen}
              className="px-3 py-2"
            >
              <ol className="divide-y divide-border">
                {mainPool.slice(1).map((choice, index) => renderRow(choice, index + 1))}
              </ol>
            </FallbackDisclosure>
          </li>
        ) : null}
        {canAddMain ? (
          <li>
            <RoleModelPicker
              trigger={
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-b-xl px-3 py-3 text-start text-body text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Plus className="size-4" aria-hidden />
                  <Trans>Add model</Trans>
                </button>
              }
              label={t`Add model`}
              options={options.filter((option) =>
                rows.every((row) => !sameChoice(row, choiceOf(option))),
              )}
              providers={providers}
              disabled={pickerLocked}
              onPick={(option) => (option ? void place("main", "add", choiceOf(option)) : null)}
              onConnect={connectFor("addMain")}
              reopen={reopenFor("addMain")}
              onReopened={() => setReopen(null)}
            />
          </li>
        ) : null}
        <li>
          <FallbackDisclosure
            count={backupPool.length}
            open={backupsOpen}
            onOpenChange={setBackupsOpen}
            className="px-3 py-2"
          >
            <ol className="divide-y divide-border">
              {backupPool.map((choice, index) => renderRow(choice, mainPool.length + index))}
            </ol>
            {canAddBackup ? (
              <RoleModelPicker
                trigger={
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-b-xl px-3 py-3 text-start text-body text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <Plus className="size-4" aria-hidden />
                    <Trans>Add fallback</Trans>
                  </button>
                }
                label={t`Add fallback`}
                options={options.filter((option) =>
                  rows.every((row) => !sameChoice(row, choiceOf(option))),
                )}
                providers={providers}
                disabled={pickerLocked}
                onPick={(option) => (option ? void place("backup", "add", choiceOf(option)) : null)}
                onConnect={connectFor("addBackup")}
                reopen={reopenFor("addBackup")}
                onReopened={() => setReopen(null)}
              />
            ) : null}
          </FallbackDisclosure>
        </li>
      </ol>
      {panel}
      {state.busy && !settings ? (
        <Spinner className="mt-3" aria-label={t`Loading model catalog…`} />
      ) : null}
      {state.error ? (
        <div role="alert" className="mt-2 text-body text-destructive">
          {state.error}
          <Button variant="ghost" disabled={state.busy} onClick={() => void controller.load()}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : null}
    </section>
  );
}
