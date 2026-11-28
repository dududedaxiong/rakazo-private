import { Trans, useLingui } from "@lingui/react/macro";
import type { SettingsScope } from "@rakazo_mickvvw/contracts";
import { Button, OptionSelect, SectionHeading } from "@rakazo_mickvvw/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";

/**
 * The prompt template the computer-use model runs with, if any. Saving applies
 * at once; the next computer run uses the new prompt.
 */
export function ComputerPersonaPicker({ userId, scope }: { userId: string; scope: SettingsScope }) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const personaInput = { expectedUserId: userId, scope };
  const persona = useQuery(queries.models.computerPersona.queryOptions({ input: personaInput }));
  const templates = useQuery(queries.promptTemplates.list.queryOptions());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = persona.data?.promptTemplateId ?? null;
  const loadError = persona.error ?? templates.error;
  const loading = persona.isPending || templates.isPending;

  async function save(promptTemplateId: string | null) {
    if (saving || promptTemplateId === current) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await rpc.models.setComputerPersona({
        promptTemplateId,
        expectedUserId: userId,
        scope,
      });
      queryClient.setQueryData(
        queries.models.computerPersona.queryKey({ input: personaInput }),
        saved,
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-8" data-testid="computer-persona">
      <div className="mb-2.5 flex min-h-7 items-center justify-between gap-3">
        <SectionHeading variant="heading">{t`Computer persona`}</SectionHeading>
      </div>
      <OptionSelect
        id="computer-persona"
        aria-label={t`Computer persona`}
        data-testid="computer-persona-select"
        value={current ?? ""}
        options={[
          { value: "", label: t`None` },
          ...(templates.data ?? []).map((template) => ({
            value: template.id,
            label: template.name,
          })),
        ]}
        onValueChange={(value) => void save(value === "" ? null : value)}
        disabled={saving || loading || Boolean(loadError)}
      />
      {loadError ? (
        <div role="alert" className="mt-2 text-body text-destructive">
          {errorText(loadError)}
          <Button
            variant="ghost"
            disabled={loading}
            onClick={() => {
              void persona.refetch();
              void templates.refetch();
            }}
          >
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
