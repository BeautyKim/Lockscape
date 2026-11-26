// Run by `npm version`: package.json already has the new version here. Copy it into manifest.json and record the
// minimum Obsidian version for it in versions.json (older apps use that file to pick a release they can run).
// To raise the minimum, edit `minAppVersion` in manifest.json and commit it before running `npm version`.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.env.npm_package_version;
if (!version) throw new Error("Run this through `npm version patch|minor|major`.");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Obsidian only accepts x.y.z versions, not "${version}".`);

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const write = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + "\n");

const manifest = read("manifest.json");
manifest.version = version;
write("manifest.json", manifest);

const versions = read("versions.json");
versions[version] = manifest.minAppVersion;
write("versions.json", versions);
