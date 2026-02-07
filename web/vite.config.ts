import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit(), tsconfigPaths()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },

  test: {
    expect: { requireAssertions: true },
    setupFiles: ["src/tests/setup.ts"],
    projects: [
      {
        extends: "./vite.config.ts",
        test: {
          environment: "jsdom",
          globals: true,
          include: ["src/lib/**/*.{test,spec}.{js,ts}"],
        },
      },

      {
        extends: "./vite.config.ts",

        test: {
          name: "browser",

          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "chromium", headless: true }],
          },

          include: ["src/routes/**/*.{test,spec}.{js,ts}"],
        },
      },
    ],

    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/*.config.*", "**/node_modules/**", "**/dist/**"],
    },
    reporters: ["default"],
  },
  resolve: {
    // Tell Vitest to use the `browser` entry points in `package.json` files, even though it's running in Node
    ...(process.env.VITEST
      ? {
          conditions: ["browser"],
        }
      : {}),
  },
});
