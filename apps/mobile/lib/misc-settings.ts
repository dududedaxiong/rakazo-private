import type { MiscSettings } from "@rakazo_mickvvw/contracts";
import { rpc } from "./api";

export function getMiscSettings() {
  return rpc("miscSettings/get");
}

export function saveMiscSettings(settings: MiscSettings) {
  return rpc("miscSettings/set", settings);
}
