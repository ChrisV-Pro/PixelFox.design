import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://pixelfox.design",
  output: "static",
  build: {
    format: "directory",
  },
  trailingSlash: "always",
});
