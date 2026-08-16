# Contributing to MyBay Open Source

[English](./CONTRIBUTING.md) | [简体中文](./docs/CONTRIBUTING.zh-CN.md)

Thank you for considering a contribution to MyBay Open Source. Community contributions help make self-hosted AI Agent management safer and more useful.

## Project Scope & Philosophy

This repository hosts the **local-first open-source edition** of MyBay.

### Core Focus
- Local administrator authentication and session security
- Local SQLite state persistence in `data/mybay.sqlite`
- BYOK (Bring Your Own Keys) model provider configuration
- Hermes Agent container lifecycle management (spawn, stop, restart, hot update, logs, status)
- Interactive Chat Workspace, code blocks, execution traces, artifacts, and file downloads
- Single-command local deployment with Docker Compose

### Out of Scope for Community Edition
To keep PR review smooth, please refrain from adding these features without prior discussion:
- SaaS cloud billing, quota systems, or paid credits
- Requirements for hosted platform databases
- Multi-tenant cloud orchestration or remote node scheduling
- Hardcoded proprietary API keys or production cloud secrets

---

## Getting Started

### Prerequisites
- Node.js 22.13.0 or later
- Docker Engine / Docker Desktop (running locally)

### Setup Development Environment

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/mybay-ai/mybay.git
   cd mybay
   ```

2. Install dependencies:
   ```bash
   npm ci
   ```

3. Create environment configuration:
   ```bash
   cp .env.example .env
   ```
   Set `JWT_SECRET`, `ENCRYPTION_KEY`, `LOCAL_ADMIN_USERNAME`, and `LOCAL_ADMIN_PASSWORD` in `.env`.

4. Start the development server:
   ```bash
   npm run dev
   ```

---

## Development Workflow

### Code Standards & Practices
- **TypeScript**: All new code must be written in strict TypeScript.
- **Tailwind CSS**: Use Tailwind utility classes for styling. Avoid inline styles or new custom CSS files.
- **Minimal Changes**: Keep changes focused on the task. Avoid unnecessary refactoring or formatting changes in unrelated files.
- **No Hardcoded Secrets**: Never commit API keys, tokens, or credentials.

### Verification Before Submitting
Before opening a Pull Request, run the complete local verification suite:

```bash
npm run check
```

---

## Submitting Pull Requests (PR)

1. Create a descriptive branch for your work:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. Commit your changes with clear messages in English:
   ```bash
   git commit -m "feat: add support for custom docker network selection"
   ```

3. Push to your fork and submit a Pull Request to the `main` branch.

4. In your PR description, explain:
   - What problem does this PR solve?
   - What changes were made?
   - How can maintainers test and verify your changes?

---

## Reporting Security Issues

Please **do not** report security vulnerabilities through public GitHub issues.

Follow our [Security Policy](./SECURITY.md) and report security issues privately to the project maintainers.

---

## Contribution License and Future CLA Decisions

Contributions submitted under the current process are licensed under the repository's [`AGPL-3.0-only`](./LICENSE) license.

The project does not currently require a Contributor License Agreement (CLA) or copyright assignment. If the maintainers later introduce a CLA for a commercial relicensing model, it will require a separate, explicit governance and legal decision; community contributions must not be assumed to grant proprietary relicensing rights before that process exists.

This section describes the current contribution policy and is not legal advice.
