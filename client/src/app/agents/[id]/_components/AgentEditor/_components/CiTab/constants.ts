import type { CiFailOn } from "@devdigest/shared";

/** CI gate policy options (mirrors `ConfigTab/constants.ts`'s
 *  `CI_FAIL_ON_VALUES` — kept local rather than imported so this tab has no
 *  compile-time coupling to a sibling tab's file). Labels are i18n'd via
 *  `ciTab.failCiOnOptions.<value>`. */
export const CI_FAIL_ON_VALUES: readonly CiFailOn[] = ["never", "critical", "warning", "any"];
