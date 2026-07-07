/**
 * Path-based classification patterns + split-suggestion thresholds for Smart
 * Diff. Kept apart from `helpers.ts` so patterns can be tuned (new ecosystem,
 * new generated-file convention, …) without touching classification logic.
 *
 * Security (ReDoS): every pattern below is linear — no nested/adjacent
 * unbounded quantifiers — so classifying an attacker-influenced GitHub file
 * path cannot backtrack catastrophically. Keep any added pattern linear and
 * anchored (`^`/`$`/`(^|\/)`).
 */

/** Matched against the full file path. Precedence: checked BEFORE wiring. */
export const BOILERPLATE_PATTERNS: RegExp[] = [
  // lockfiles
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json|bun\.lockb|composer\.lock|Gemfile\.lock|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|flake\.lock)$/,
  // build/generated output dirs
  /(^|\/)(dist|build|out|coverage|\.next|node_modules|vendor)\//,
  // minified + source maps
  /\.min\.(js|css)$/,
  /\.map$/,
  // snapshots
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  // generated markers
  /(^|\/)generated\//,
  /\.(generated|gen)\.[a-zA-Z]+$/,
  // drizzle snapshot meta
  /(^|\/)db\/migrations\/meta\//,
];

/** Matched against the full file path. Checked only if no boilerplate pattern matched. */
export const WIRING_PATTERNS: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  // config files
  /(^|\/)[^/]*\.config\.(js|ts|mjs|cjs|json)$/,
  // dotfiles/tooling
  /(^|\/)\.(eslintrc|prettierrc|babelrc|editorconfig|gitignore|gitattributes|npmrc|nvmrc)/,
  // barrels/glue
  /(^|\/)index\.(ts|tsx|js|jsx)$/,
  // type declarations
  /\.d\.ts$/,
  // CI/containers
  /(^|\/)\.github\//,
  /(^|\/)Dockerfile$/,
  /(^|\/)docker-compose[^/]*\.ya?ml$/,
  // other yaml (CI/config-ish)
  /\.ya?ml$/,
];

/** Total changed lines above which the PR is considered "too big". */
export const SPLIT_TOO_BIG_LINES = 400;

/** Minimum distinct top-level dirs among `core` files to suggest a by-directory split. */
export const SPLIT_MIN_CORE_DIRS = 2;
