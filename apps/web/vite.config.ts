// Two pages: the game (index.html) and the admin hub (admin.html). The labs and previews
// (gallery, preview, caves-lab, avatar-lab) stay dev-only, as before.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  build: {
    rolldownOptions: {
      input: { main: page("index.html"), admin: page("admin.html") },
    },
  },
});
