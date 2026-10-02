# Project website

This file's portal is a **web portal**: `cabn.json` overrides its preview
with a `url` preview, so instead of this text the arch shows the live page.

- Walk up to the arch and the page loads inside it (a sandboxed iframe).
- Click the page in the arch, or "Open in browser" in the side panel, to
  open it in a new browser tab.
- Only origins listed in `cabn.json`'s `allowedEmbedOrigins` can be framed
  or opened.

The demo points at https://example.com/, which is known to allow framing.
