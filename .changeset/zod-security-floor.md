---
"@cabn/world-schema": patch
"@cabn/converter": patch
"@cabn/engine": patch
"@cabn/cli": patch
---

Raise the `zod` dependency floor to ^4.6.7, past GHSA-mrhx-c7xc-m3w5 (memory exhaustion while validating oversized constrained collections).
