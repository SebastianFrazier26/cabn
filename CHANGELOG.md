# Changelog

## 2026-09-20

- Repo rebooted as a TypeScript pnpm monorepo (M0 scaffold): workspaces for `packages/*`, `apps/*`, `tools/*`; TypeScript strict ESM, Biome, Vitest, Node 22, CI workflow.
- Rust prototype parked on the `rust-prototype` branch and removed from this branch.
- Icons moved to `assets/source/icons/`.
- Asset pipeline (M2): `@cabn/asset-pipeline` extracts a 28-color canonical palette from the five source icons (hand-rolled median-cut, no quantization library), attempts true-pixel sprite recovery (content-bbox crop, nearest-dominant downscale, palette-snap, gradient-tolerant flood-fill background removal), generates three hand-drawn placeholder sprites from a declarative pixel-map format, and writes a static `assets/generated/preview.html` for human review. Generated palette, recovered sprites, placeholders, and preview are committed; `manifest.json` lets future edits lock individual placeholders against regeneration.
