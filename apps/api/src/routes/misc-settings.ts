import { getMiscSettings, saveMiscSettings } from "../misc-settings.js";
import type { RouterContext } from "./context.js";

export function miscSettingsRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    miscSettings: {
      get: authed.miscSettings.get.handler(async ({ context }) => {
        return getMiscSettings(deps, context.actor);
      }),
      set: authed.miscSettings.set.handler(async ({ context, input }) => {
        return saveMiscSettings(deps, context.actor, input);
      }),
    },
  };
}
