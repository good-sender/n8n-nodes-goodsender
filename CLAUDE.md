# CLAUDE.md — n8n-nodes-goodsender

n8n community node package for GoodSender (TypeScript). A thin integration over
the GoodSender public API — business logic lives in `goodsender-web` (source of
truth). See the workspace umbrella `CLAUDE.md` for cross-repo rules.

## Setup & gates

```bash
npm install
npm run lint        # n8n-node lint (ESLint 9)
npm run build       # n8n-node build → ./dist
```
No unit tests yet. CI (`.github/workflows/ci.yml`) lints + builds on PRs.

- Package manager: **npm** (package-lock.json). Build tooling: `@n8n/node-cli`.
- Nodes live in `nodes/`, credentials in `credentials/`.

## Conventions

Conventional Commits; branch off `main` (`feat/ fix/ …`), one PR per backlog
item, label PRs `autopilot`. `main` is protected; `publish.yml` publishes to npm
on version tags — never tag/release without approval. Keep the node
backwards-compatible with the public API contract (umbrella golden rule #2).
