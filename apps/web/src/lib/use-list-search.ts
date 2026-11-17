import type { ListSearchOptions } from "@rakazo_mickvvw/core";
import { listSearch } from "@rakazo_mickvvw/core";
import { useState } from "react";

export function useListSearch<T>(items: readonly T[], options: ListSearchOptions<T>) {
  const [query, setQuery] = useState("");
  return { query, setQuery, ...listSearch(items, query, options) };
}
