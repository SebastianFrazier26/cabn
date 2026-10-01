import { parentPort } from "node:worker_threads";

// Reports the worker's environment back as the "zip" bytes.
const body = new TextEncoder().encode(JSON.stringify(process.env));
parentPort.postMessage({ kind: "ok", zip: body });
