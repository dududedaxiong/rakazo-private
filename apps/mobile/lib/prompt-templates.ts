import { useQuery } from "@tanstack/react-query";
import { accountRpcQuery, queryClient } from "./query";

/** The account's prompt templates, the same in every space. */
export function promptTemplatesQuery() {
  return accountRpcQuery("promptTemplates/list");
}

export function usePromptTemplates() {
  return useQuery({ ...promptTemplatesQuery() }, queryClient);
}

/** Forgets the cached template list, so the next read fetches it again. */
export function invalidatePromptTemplates(): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[2] === "promptTemplates/list",
  });
}
