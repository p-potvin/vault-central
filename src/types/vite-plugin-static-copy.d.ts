/**
 * vite-plugin-static-copy@4.0.0 declares `types: ./dist/index.d.ts` in its
 * package.json but the installed package ships `dist/index.js` only, so tsc
 * fails to resolve types for vite.config.ts (TS7016) and blocks `npm run build`.
 *
 * Declared locally with the surface we actually use rather than falling back to
 * `any`, so the copy targets in vite.config.ts stay type-checked.
 */
declare module 'vite-plugin-static-copy' {
  import type { Plugin } from 'vite';

  export interface StaticCopyTarget {
    src: string | string[];
    dest: string;
    rename?: string | { stripBase?: boolean } | ((fileName: string, fileExtension: string, fullPath: string) => string);
    transform?: (content: string, path: string) => string | null | undefined | Promise<string | null | undefined>;
  }

  export interface StaticCopyOptions {
    targets: StaticCopyTarget[];
    flatten?: boolean;
    silent?: boolean;
    watch?: { reloadPageOnChange?: boolean; options?: Record<string, unknown> };
    structured?: boolean;
  }

  export function viteStaticCopy(options: StaticCopyOptions): Plugin[];
}
