# Code host

A web portal whose site refuses to be framed: its response carries
`X-Frame-Options: deny`. `cabn build` checks that once at build time and
records it in `embeds.json`, so the world never tries the iframe; the arch
shows a title card and the side panel an "Open in browser" button.

Build with `--offline` to skip the check (every url is then assumed framable).
