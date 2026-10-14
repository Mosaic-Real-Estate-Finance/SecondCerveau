import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import { ToastProvider } from "@/components/toast";
import { RecordScreen } from "@/screens/RecordScreen";

// The screens of the install dialog's screenshots (manifest `screenshots`),
// rendered from the app's own components with made-up data. Local only:
// `npm run screenshots` serves this page with vite.store-screens.config.ts,
// which swaps the recorder, the notes and the network check for stand-ins,
// and captures it. Never part of the production build.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      {/* The app's own page frame (App.tsx), which the screen measures itself in. */}
      <div className="t-page-slide mx-auto h-full max-w-[480px]" data-page={1}>
        <section className="t-page" data-page-id="1">
          <RecordScreen active firstName="Sophie" reviewCount={2} onRecorded={() => {}} onReview={() => {}} onSettings={() => {}} />
        </section>
      </div>
    </ToastProvider>
  </StrictMode>,
);
