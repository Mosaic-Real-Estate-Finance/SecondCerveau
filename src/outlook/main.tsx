import { createRoot } from "react-dom/client";
import "@/styles/index.css";
// After the dictation's sheet, because it undoes part of it. See the file.
import "./outlook.css";
import { Panel } from "./Panel";
import { selectEntraConfig } from "./auth";
import { currentUser, ready } from "./office";

// The taskpane boots only once Office is ready: reading the open mail before
// that returns nothing, and the panel would show an empty thread as if the
// mail had none.
//
// Opened outside Outlook — a plain browser tab, which is how the layout gets
// looked at — `ready()` is false and the panel says so rather than hang.
//
// The Entra registration is chosen here, between the two: the mailbox address
// is only readable once Office is ready, and MSAL must not exist before the
// choice is made (./entra-config.ts).
void ready().then((inOutlook) => {
  if (inOutlook) selectEntraConfig(currentUser());
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<Panel inOutlook={inOutlook} />);
});
