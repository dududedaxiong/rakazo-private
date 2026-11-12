import type { ModelRoleChoice } from "@rakazo/contracts";
import { modelRoleChoiceKey } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { dropRemovedRoleRows } from "./model-role-removal";

function row(
  modelId: string,
  credentialId: string | null,
  provider = "openai-compatible",
): ModelRoleChoice {
  return credentialId ? { provider, modelId, credentialId } : { provider, modelId };
}

function key(choice: ModelRoleChoice): string {
  return modelRoleChoiceKey(choice);
}

describe("dropRemovedRoleRows", () => {
  it("drops the row that names the removed model on the removed connection", () => {
    const rows = [row("deepseek-v4.1-flash", "cred-test"), row("glm-5.3-flash", "cred-test")];
    const next = dropRemovedRoleRows(
      rows,
      {
        key: key(row("deepseek-v4.1-flash", "cred-test")),
        modelId: "deepseek-v4.1-flash",
        credentialId: "cred-test",
      },
      () => undefined,
    );
    expect(next).toEqual([row("glm-5.3-flash", "cred-test")]);
  });

  it("keeps the same model on another connection", () => {
    const rows = [row("deepseek-v4.1-flash", "cred-test"), row("deepseek-v4.1-flash", "cred-gb")];
    const next = dropRemovedRoleRows(
      rows,
      {
        key: key(row("deepseek-v4.1-flash", "cred-test")),
        modelId: "deepseek-v4.1-flash",
        credentialId: "cred-test",
      },
      () => undefined,
    );
    expect(next).toEqual([row("deepseek-v4.1-flash", "cred-gb")]);
  });

  it("drops a row with no connection whose provider resolves to the removed one", () => {
    const rows = [row("deepseek-v4.1-flash", null), row("glm-5.3-flash", "cred-gb")];
    const next = dropRemovedRoleRows(
      rows,
      {
        key: key(row("deepseek-v4.1-flash", "cred-test")),
        modelId: "deepseek-v4.1-flash",
        credentialId: "cred-test",
      },
      () => ({ id: "cred-test" }),
    );
    expect(next).toEqual([row("glm-5.3-flash", "cred-gb")]);
  });

  it("keeps a row with no connection whose provider resolves elsewhere", () => {
    const rows = [row("deepseek-v4.1-flash", null)];
    const next = dropRemovedRoleRows(
      rows,
      {
        key: key(row("deepseek-v4.1-flash", "cred-test")),
        modelId: "deepseek-v4.1-flash",
        credentialId: "cred-test",
      },
      () => ({ id: "cred-gb" }),
    );
    expect(next).toEqual(rows);
  });

  it("keeps rows with a different model", () => {
    const rows = [row("glm-5.3-flash", "cred-test")];
    const next = dropRemovedRoleRows(
      rows,
      {
        key: key(row("deepseek-v4.1-flash", "cred-test")),
        modelId: "deepseek-v4.1-flash",
        credentialId: "cred-test",
      },
      () => undefined,
    );
    expect(next).toEqual(rows);
  });

  it("leaves an empty list empty", () => {
    const next = dropRemovedRoleRows(
      [],
      {
        key: key(row("deepseek-v4.1-flash", "cred-test")),
        modelId: "deepseek-v4.1-flash",
        credentialId: "cred-test",
      },
      () => undefined,
    );
    expect(next).toEqual([]);
  });
});
