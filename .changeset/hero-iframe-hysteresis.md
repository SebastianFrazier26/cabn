---
"@cabn/engine": patch
---

The live page over a url arch no longer loads while the world is still entering, and no longer reloads when you brush past an arch. The first mount waits for world entry plus an idle moment; once mounted it stays until you are well clear of the arch (1.6x the mount radius) for 4 seconds, so turning back keeps the loaded page.
