/**
 * Runs once when the server starts. On the Node runtime only, it starts the
 * background address-lookup retry (see instrumentation-node.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
