import { Buffer } from "buffer";

// isomorphic-git (and sha.js under it) use a global Buffer, which only Node
// has. Imported first by browserRepo.ts, before isomorphic-git evaluates.
const g = globalThis as { Buffer?: unknown };
g.Buffer ??= Buffer;
