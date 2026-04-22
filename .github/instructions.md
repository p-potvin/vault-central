# 🛠 VaultWares Enterprise-wide Guidelines for Programming Projects

VaultWares builds consumer-facing tools with a clear order of priorities: **Individuals' Privacy first**, **Security second**, and **Functionality third**. Privacy and security are related but not interchangeable: privacy is about limiting and controlling data, while security is how we protect what exists. We aim to strike a practical balance and avoid fear-driven “security” theater that bad actors exploit and that quietly undermines privacy.

## 1. Core Tech Stack (varies by project, needs, and team preferences)

**- Everything must be integrated with Google Cloud Services: Run, Deploy, Build, SQL Tools, etc.**

**- Frontend Frameworks: Next.js 15+ (App Router), DJango, Blazor**

**- Languages: TypeScript (Strict mode), Python, C#**

**- Styling: Tailwind CSS with both light and dark mode support. Refer to STYLE.md for more details.**

**- State Management: TanStack Query (React Query) for server state; Zustand for local state.**

**- Database/Backend: CloudSQL Tools: PostgreSQL, GCP Secret Manager**

**- UI Components: Radix UI primitives / Shadcn UI.**

## 2. Coding Standards & Patterns

**- When generating code for VaultWares projects, adhere to the following when applicable:**

**- Component Architecture: Use Functional Components with Arrow Syntax. Favor Server Components for data fetching and Client Components only when interactivity is required.**

**- Always separate your declarations with a space (e.g., x = 5, not x=5)**

**- Add empty lines between logical blocks of code for better readability. For example, separate imports, component definitions, hooks, and return statements with empty lines.**

**- Use consistent indentation (4 spaces) and avoid mixing tabs and spaces.**

**- Keep comments inside functions to a minimum, if you need to define behavior, do it when declaring the function, not inside it.**

**- When using an external library method, leave a comment indicating the default values and any important considerations.**

**- Follow language conventions for anything else.**

###   Naming Conventions: 

**- Components: PascalCase (e.g., ProductVault.tsx)**

**- Hooks: camelCase starting with 'use' (e.g., useVaultAuth.ts)**

**- Utilities: kebab-case (e.g., format-currency.ts)**

### Coding Best Practices

**- Type Safety: Avoid any at all costs. Use Zod for schema validation (especially for API responses and form inputs).**

**- Performance: Keep the bloating to a minimum and optimize your methods. e.g., Implement React Suspense for loading states and utilize Next.js Image component for all assets.**

**- Always implement the functionality 'CorrelationId' in logs to allow easy debugging.**

**- Review your code before finalizing to make sure there are no syntax errors, trailing artifacts, debugging statements, unused imports, etc.**

**- API Routes: Use Next.js API routes for serverless functions. Validate all inputs with Zod and handle errors gracefully.**

## 3. Style Guide (Tailwind)

**View STYLE.md**

## 4. Specific Constraints for Gemini

**- Privacy First (Primary): Minimize personal data collection, avoid hidden tracking/fingerprinting, and keep personal data out of logs/analytics by default. Prefer explicit consent and privacy-preserving defaults.**

**- Security (Second): Follow OWASP principles. Always validate and sanitize user input. If writing SQL or Supabase queries, ensure Row Level Security (RLS) and least-privilege access are considered.**

**- Functionality (Third): Keep flows understandable for non-technical users. Make the safe choice the easy choice, and prefer clarity over cleverness.**

**- Error Handling: Use a centralized error-boundary pattern. Don't just console.log(error); provide user-friendly feedback using a Toast component.**

**- DRY (Don't Repeat Yourself): Look for existing code that can be reused. e.g., check @/components/ui before creating new UI elements to avoid duplicating Shadcn components.**
