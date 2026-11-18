---
"@cabn/engine": patch
---

The player walks at the same speed regardless of frame rate. Phaser's time step was replacing any frame slower than 200 ms with a 16.7 ms stand-in, so machines under 5 fps walked in slow motion; frames up to 500 ms now count as real time and the camera follow eases at the same rate at any frame rate.
