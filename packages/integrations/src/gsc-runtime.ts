import { GscClient } from "./gsc-client";
// Server composition port. Trusted startup code may install an integration;
// there is no HTTP/environment endpoint override in the application.
const key = Symbol.for("orbit.gsc-client");
const root = globalThis as typeof globalThis & { [key]?: GscClient };
export function installGscClient(client: GscClient) {
  root[key] = client;
}
export function getGscClient() {
  return (root[key] ??= new GscClient());
}
