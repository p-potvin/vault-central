# 🛡️ VaultWares
**High-Security Digital Asset & Hardware Marketplace**

VaultWares is a premium e-commerce platform built with a "Security-First" philosophy. It leverages a modern, type-safe stack to deliver a seamless shopping experience for high-value digital and physical assets. It also handles a vast array of projects in many different spheres. This is a general guideline to apply when coding under the VaultWares umbrella.

## 🚀 Tech Stack
- **Frontend:** [Next.js 15](https://nextjs.org/) (App Router), [TypeScript](https://www.typescriptlang.org/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/), [Shadcn UI](https://ui.shadcn.com/)
- **Backend/Auth:** [Supabase](https://supabase.com/) (PostgreSQL + RLS), Either [Node.js](https://nodejs.org/), [Django](https://django.com/) or [.Net](https://dotnet.microsoft.com) depending on the project
- **State Management:** [TanStack Query](https://tanstack.com/query) & [Zustand](https://docs.pmnd.rs/zustand)
- **Validation:** [Zod](https://zod.dev/)

## 🛠️ Getting Started
1. **Pull the latest version:** `git fetch; git pull`
2. **Install dependencies:** `npm install`
3. **Set up Environment:** Create a `.env.local` with your Supabase keys.
4. **Run Development:** `npm run dev`

## 🔒 Security Principles
- **Row Level Security (RLS):** Enabled on all Supabase tables.
- **Server-Side Validation:** All transactions validated via Zod schemas.
- **Minimalist Footprint:** Zero-dependency policy for non-essential features.

## 🎨 Design Language
- **Theme:** Industrial-Cyber (Dark Mode Only).
- **Core Colors:** Slate-950 (BG), Emerald-400 (Accents), White/10 (Glassmorphism).