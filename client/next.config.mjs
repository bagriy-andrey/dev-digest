import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  // `src/vendor/shared/**` (the vendored @devdigest/shared contracts) uses
  // TS/ESM-style cross-file imports with an explicit `.js` extension that
  // points at a sibling `.ts` file (`import ... from './findings.js'`) —
  // valid under tsconfig's `moduleResolution: "Bundler"` and understood by
  // tsc/Vitest, but webpack's default resolver only tries the LITERAL
  // extension on an explicit request, so it never falls back to `.ts`.
  // Without this alias, any RUNTIME (non-type-only) import that pulls the
  // vendor/shared barrel into the actual bundle fails with "Module not
  // found" the first time it's exercised — type-only imports are erased
  // before reaching webpack, so this stayed latent until one existed.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
