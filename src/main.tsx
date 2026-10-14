import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { busy } from "@/lib/pipeline";
import { guardSafeTop } from "@/lib/safe-area";
import { track } from "@/lib/track";
import "./styles/index.css";

// The app never runs inside a frame of its own. Its install guide frames a
// page of this origin; were that page ever answered with the app (a service
// worker serving the shell for it did exactly that), the app would open its
// guide inside the guide, and again inside that one.
const framed = window.self !== window.top;

// A new version takes over at once, but the page reloads into it only when
// nothing is under way: a reload in the middle of a dictation would cut the
// recording and its live stream.
if (!framed) registerSW({
  immediate: true,
  onNeedReload() {
    const reloadWhenIdle = () => (busy() ? window.setTimeout(reloadWhenIdle, 5000) : window.location.reload());
    reloadWhenIdle();
  },
});
guardSafeTop();

if (!framed) track("Le site a été ouvert");

if (!framed)
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
