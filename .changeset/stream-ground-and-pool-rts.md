---
"@cabn/engine": patch
---

Smoother walking: no more multi-second stalls near large clearings; faster world entry. A big clearing's ground is now baked as 512px tiles that stream in and out like the rest of the world instead of as one texture up to 2752x2784px, streamed chunk textures are recycled through a pool instead of being created and destroyed, the first screen bakes across the loading card's frames instead of in one block, and the unused WebAudio context is no longer created at boot.
