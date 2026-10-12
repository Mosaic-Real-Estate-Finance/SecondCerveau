import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { busy } from "@/lib/pipeline";
import { guardSafeTop } from "@/lib/safe-area";
import "./styles/index.css";

// A new version takes over at once, but the page reloads into it only when
// nothing is under way: a reload in the middle of a dictation would cut the
// recording and its live stream.
registerSW({
  immediate: true,
  onNeedReload() {
    const reloadWhenIdle = () => (busy() ? window.setTimeout(reloadWhenIdle, 5000) : window.location.reload());
    reloadWhenIdle();
  },
});
guardSafeTop();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Two frames after mount the first paint is on screen: the cover can go.
const cover = document.getElementById("splash-cover");
if (cover) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      cover.classList.add("is-gone");
      cover.addEventListener("transitionend", () => cover.remove(), { once: true });
      setTimeout(() => cover.remove(), 600);
    }),
  );
}
