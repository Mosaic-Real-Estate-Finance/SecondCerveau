import { isIOS, isStandalone } from "@/lib/standalone";

// --safe-top is env(safe-area-inset-top), which every layout pads by. Some
// iOS builds lay an installed app out under the status bar and still report
// an inset of zero: the settings and the « Accueil » button then sat under
// the clock and the battery. When the page reaches the top of the screen and
// the inset says nothing, the status bar's height is supplied instead.
//
// Android reports the inset correctly, and a browser tab keeps its own bar
// above the page, so both are left alone.

// Portrait status bar heights: Dynamic Island, notch, home button.
const statusBar = () => (screen.height >= 852 ? 59 : screen.height >= 812 ? 47 : 20);

function reportedInset(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const inset = probe.offsetHeight;
  probe.remove();
  return inset;
}

function apply() {
  const root = document.documentElement.style;
  root.removeProperty("--safe-top");
  // Landscape hides the status bar altogether.
  if (window.innerWidth > window.innerHeight) return;
  if (reportedInset() > 0) return;
  // An opaque bar reserved by the system leaves the page shorter than the screen.
  if (window.innerHeight < screen.height - 1) return;
  root.setProperty("--safe-top", `${statusBar()}px`);
}

export function guardSafeTop() {
  if (!isIOS() || !isStandalone()) return;
  apply();
  window.addEventListener("orientationchange", () => setTimeout(apply, 300));
}
