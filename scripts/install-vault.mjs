/**
 * Copy built plugin artifacts into an Obsidian vault.
 *
 * Usage:
 *   node scripts/install-vault.mjs [vaultPath]
 *
 * Default vault: ZOOM_OBSIDIAN_VAULT env, else common local path.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");

const vaultArg = process.argv[2] || process.env.ZOOM_OBSIDIAN_VAULT;
if (!vaultArg) {
  console.error(
    "Usage: node scripts/install-vault.mjs <vaultPath>\n" +
      "   or: set ZOOM_OBSIDIAN_VAULT and run npm run install-vault"
  );
  process.exit(1);
}

const vault = path.resolve(vaultArg);
const dest = path.join(vault, ".obsidian", "plugins", "zoom-mynotes-sync");

const files = ["main.js", "manifest.json", "styles.css"];
for (const f of files) {
  const from = path.join(pluginRoot, f);
  if (!fs.existsSync(from)) {
    console.error(`Missing ${from} — run npm run build first`);
    process.exit(1);
  }
}

fs.mkdirSync(dest, { recursive: true });
for (const f of files) {
  fs.copyFileSync(path.join(pluginRoot, f), path.join(dest, f));
  console.log("copied", f);
}

const community = path.join(vault, ".obsidian", "community-plugins.json");
let list = [];
if (fs.existsSync(community)) {
  try {
    list = JSON.parse(fs.readFileSync(community, "utf8"));
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
}
if (!list.includes("zoom-mynotes-sync")) {
  list.push("zoom-mynotes-sync");
  fs.writeFileSync(community, JSON.stringify(list, null, 2) + "\n", "utf8");
  console.log("enabled in community-plugins.json");
} else {
  console.log("already enabled in community-plugins.json");
}

console.log(`Installed → ${dest}`);
console.log("Reload Obsidian (or disable/enable the plugin) to pick up changes.");
