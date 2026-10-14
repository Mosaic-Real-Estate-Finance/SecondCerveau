// Stands in for src/lib/connectivity.ts in the screenshot build: always online.
export type Connectivity = "checking" | "online" | "unstable" | "offline";
export function useConnectivity(_active: boolean) {
  return { status: "online" as Connectivity, check: async () => undefined };
}
