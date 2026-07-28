import next from "eslint-config-next";

/**
 * Flat config: `next lint` was removed in Next 16, so ESLint is run directly.
 *
 * The generated Prisma client and the build output are not ours to lint, and
 * linting them is slow enough to stop anyone from running this at all.
 */
const config = [
  {
    ignores: ["generated/**", ".next/**", "node_modules/**", "public/sw.js"],
  },
  ...next,
];

export default config;
