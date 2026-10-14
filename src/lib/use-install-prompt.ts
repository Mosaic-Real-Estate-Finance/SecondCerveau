import { useCallback, useSyncExternalStore } from "react";
import {
  canPromptInstall,
  detectPlatform,
  installPrompt,
  isStandalone,
  promptInstall,
  subscribeInstall,
  type InstallOutcome,
  type Platform,
} from "@/lib/standalone";

/**
 * Everything the install guide needs to know, in one place.
 *
 * - `canInstall`: the native dialog is available (Chromium sent
 *   `beforeinstallprompt` and it has not been used yet).
 * - `isIOS`: Safari on iOS, where installing goes through the Share sheet.
 * - `isStandalone`: already running as the installed app — nothing to offer.
 * - `promptInstall()`: the native dialog; from a click only.
 * - `dismiss()`: closed or refused, the guide stays away for a while.
 *
 * Safe without a window (server rendering, tests): every read guards it.
 */
export function useInstallPrompt() {
  const canInstall = useSyncExternalStore(subscribeInstall, canPromptInstall, () => false);
  const platform: Platform = typeof window === "undefined" ? "desktop" : detectPlatform();
  const install = useCallback(async (): Promise<InstallOutcome> => {
    const outcome = await promptInstall();
    if (outcome === "dismissed") installPrompt.dismiss();
    return outcome;
  }, []);
  return {
    canInstall,
    platform,
    isIOS: platform === "ios-safari",
    isStandalone: isStandalone(),
    promptInstall: install,
    dismiss: installPrompt.dismiss,
  };
}
