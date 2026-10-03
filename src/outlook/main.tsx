import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import { Panel } from "./Panel";
import { ready } from "./office";

// The taskpane boots only once Office is ready: reading the open mail before
// that returns nothing, and the panel would show an empty thread as if the
// mail had none.
//
// Opened outside Outlook — a plain browser tab, which is how the layout gets
// looked at — `ready()` is false and the panel says so rather than hang.
void ready().then((inOutlook) => {
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<Panel inOutlook={inOutlook} />);
});
