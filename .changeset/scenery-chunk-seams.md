---
"@cabn/engine": patch
---

Trees no longer look sliced at chunk edges. In larger worlds the lazily planned forest filler was baked only into the 512px chunk that owned each tree, so any part of a tree outside that chunk was clipped by a dead-straight cut. Each chunk now also draws the parts of its neighbours' trees that reach into it.
