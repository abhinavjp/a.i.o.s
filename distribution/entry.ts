import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const directory = dirname(fileURLToPath(import.meta.url));
process.env.AIOS_CLIENT_DIR ??= join(directory, "client");
process.env.AIOS_OPEN_BROWSER ??= "1";

await import("../app/server/src/index.js");
