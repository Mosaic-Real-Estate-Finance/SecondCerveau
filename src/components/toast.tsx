import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// transitions.dev 22, toast: one class toggles the open / close asymmetry.
type ToastApi = { show: (message: string) => void };
const ToastContext = createContext<ToastApi>({ show: () => undefined });

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const timer = useRef(0);

  const show = useCallback((text: string) => {
    setMessage(text);
    setOpen(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
        style={{ top: "calc(var(--safe-top) + 12px)" }}
      >
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "t-toast max-w-[448px] rounded-2xl bg-midnight-blue px-4 py-3 text-base text-white",
            open && "is-open",
          )}
        >
          {message}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
