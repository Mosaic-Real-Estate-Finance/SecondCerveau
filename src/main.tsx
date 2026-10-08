import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { guardSafeTop } from "@/lib/safe-area";
import "./styles/index.css";

registerSW({ immediate: true });
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
