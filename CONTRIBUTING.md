# Contributing to Vault Central

Thank you for helping build Vault Central! Before submitting a pull request, please read the guidelines below to keep the codebase clean, secure, and aligned with the **VaultWares Privacy-First Standard**.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Branch & Commit Conventions](#branch--commit-conventions)
- [Folder Structure](#folder-structure)
- [Coding Standards](#coding-standards)
- [Security Checklist](#security-checklist)
- [Opening a Pull Request](#opening-a-pull-request)

---

## 🤝 Code of Conduct

All contributors are expected to act professionally and respectfully. Harassment, discrimination, or deliberate sabotage will result in permanent removal from the project.

---

## 🛠️ Getting Started

```bash
git clone https://github.com/p-potvin/vault-central.git
cd vault-central
git submodule update --init   # required for vault-themes
npm install
npm run build                 # verify the build passes before making changes
npm run test                  # verify tests pass before making changes
```

---

## 🌿 Branch & Commit Conventions

| Branch prefix | Purpose |
|---|---|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `chore/` | Tooling, dependencies, docs |
| `refactor/` | Non-functional code change |
| `security/` | Security hardening |

**Commit messages** should be short, imperative, and lower-case:

```
feat: add multi-field sort to dashboard
fix: resolve expired m3u8 link on playback
chore: update vault-themes submodule
```

---

## 🏗️ Folder Structure

```
background/scripts/   # Service worker & capture pipeline (background.ts)
src/
  components/         # React UI components
  lib/                # constants.ts, themes.ts, storage-vault, Zod schemas
  scripts/            # content.ts — injected into every page
  styles/             # Global CSS, vault-themes integration
  types/              # TypeScript interfaces; css.d.ts (required for TS 5.9+)
scripts/              # generate-themes.py
vault-themes/         # Git submodule — shared CSS token library (read-only here)
tests/                # Vitest unit tests
```

---

## ✍️ Coding Standards

1. **No `any`** — Use strict TypeScript types. Use `interface` for objects and `type` for unions/primitives.
2. **Named exports** — Prefer named exports over default exports for components and utilities.
3. **Zod validation everywhere** — All data entering or leaving storage must pass through a Zod schema. Never trust raw storage reads.
4. **No hardcoded strings** — Add new constants to `src/lib/constants.ts`.
5. **Tailwind utility classes** — Follow the existing Tailwind + `clsx`/`tailwind-merge` pattern. Do not add inline `style` props for theming.
6. **vault-themes CSS tokens** — Use token variables (e.g. `var(--vc-bg)`) defined by the active theme. Do not hardcode colour values.
7. **TanStack Query for async state** — Use `useQuery`/`useMutation` for any async data access in React components.
8. **Background worker messaging** — Use `chrome.runtime.sendMessage` / `browser.runtime.sendMessage` via the `webextension-polyfill` wrapper. Never import background logic directly into content scripts.

---

## 🛡️ Security Checklist

Before opening a PR, verify all of the following:

- [ ] No `any` types introduced — run `tsc` to confirm
- [ ] All user-facing data validated through Zod schemas
- [ ] No secrets, API keys, or credentials committed
- [ ] No new external network requests added without privacy justification
- [ ] AES-256 encryption respected for any new data written to IndexedDB when PIN is enabled
- [ ] Content script changes do not leak page data outside the extension's message bus
- [ ] No new `eval`, `innerHTML` assignments, or dynamic script injection
- [ ] Build passes: `npm run build`
- [ ] Tests pass: `npm run test`

---

## 📬 Opening a Pull Request

1. Fork the repository and create a branch from `main` using the naming convention above.
2. Make your changes and ensure the build and test suite pass locally.
3. Complete the Security Checklist above.
4. Open a PR against `main` with a clear title and description explaining **what** changed and **why**.
5. Reference any related issues with `Closes #<number>` in the PR description.

Pull requests that fail the build, skip the security checklist, or introduce `any` types will be closed until corrected.

---

## 📄 License

By contributing to this repository you agree that your contributions will be licensed under the project's [ISC License](./LICENSE).
