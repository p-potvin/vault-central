# 🛡️ VaultWares
**Privacy-First Digital Asset & Hardware Marketplace**

VaultWares builds consumer-facing products with a simple order of priorities: **individuals' privacy first**, **security second**, and **functionality third**. We use modern, type-safe tools to deliver a smooth experience for high-value digital and physical goods, but we don’t treat “security” as a substitute for privacy. Privacy is about limiting and controlling data; security is how we protect what exists. We aim to strike a practical balance and avoid fear-driven choices that quietly erode privacy. This is a general guideline to apply when coding under the VaultWares umbrella. Only use what applies to your application.

## 🚀 Tech Stack
### This is a flexible and incomplete list
- **Web Frontend:** [Next.js 15](https://nextjs.org/) (App Router), [TypeScript](https://www.typescriptlang.org/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/), [Shadcn UI](https://ui.shadcn.com/)
- **Web Backend/Auth:** [Supabase](https://supabase.com/) (PostgreSQL + RLS), Either [Node.js](https://nodejs.org/), [Django](https://django.com/) or [.Net](https://dotnet.microsoft.com) depending on the project
- **State Management:** [TanStack Query](https://tanstack.com/query) & [Zustand](https://docs.pmnd.rs/zustand)
- **Validation:** [Zod](https://zod.dev/) or native Typescript methods if Zod is causing problems
- **Native Apps Frontend:** WinUI 3 for Windows Apps, PyQt or PySide for Python GUI
- **Native Apps Backend:** C#, Python

## 🛠️ Getting Started
1. **Pull the latest version:** `git fetch; git pull`
2. **Install dependencies:** `npm install`
3. **Set up Environment:** Create a `.env.local` with your Supabase keys.
4. **Run Development:** `npm run dev`

## 🧭 Principles (Privacy → Security → Functionality)
- **Privacy First:** Default to minimal data collection, clear consent, and no hidden tracking. Keep personal data out of logs and analytics unless it’s truly necessary.
- **Security Second:** Use proven defenses (RLS/least-privilege, input validation, safe storage) to protect privacy and prevent misuse.
- **Functionality Third:** Keep the product simple, understandable, and accessible for non-technical users.

## 🎨 Design Language
- **View STYLE.md**
