---
"@cabn/engine": patch
---

Smoother walking: streamed ground chunks and the night layer no longer issue one framebuffer capture per tile or per light, which removes the 50-200 ms hitches while walking. Output is unchanged (night differs by at most 5/255 per channel where lights overlap).
