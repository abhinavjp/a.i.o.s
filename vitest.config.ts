import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{contracts,agents,app/server,app/client}/**/*.test.{ts,tsx}"],
    environment: "node",
    environmentMatchGlobs: [["app/client/**", "jsdom"]]
  }
});
