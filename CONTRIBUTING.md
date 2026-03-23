# Contributing to Grove Bench

Thanks for your interest in contributing to Grove Bench! Please read this guide before opening an issue or PR.

## Getting Started

1. Fork the repository
2. Clone your fork and install dependencies:
   ```bash
   git clone https://github.com/<your-username>/grove-bench.git
   cd grove-bench
   npm install
   ```
3. Start the dev server:
   ```bash
   npm start
   ```

## Development

- **Tech stack:** Electron 33, Svelte 5, Tailwind CSS v4, TypeScript 5.7
- **Tests:** `npm test` (Vitest)
- **Main process:** `src/main/` — IPC, git ops, PTY, sessions
- **Renderer:** `src/renderer/` — Svelte UI components
- **Landing page:** `landing/` — GitHub Pages SPA (separate Vite project)

See [CLAUDE.md](./CLAUDE.md) for full project structure and commands.

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Run `npm test` before submitting
- Follow the existing code style (no linter config — just match what's there)

## Issues

- Search existing issues before opening a new one
- Include steps to reproduce for bugs
- For feature requests, describe the use case

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
