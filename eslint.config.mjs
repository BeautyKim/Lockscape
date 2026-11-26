// The same rules the community directory's review runs, plus its type-checked TypeScript rules.
// Run from the repository root (`npm run lint`): package.json, manifest.json and LICENSE are checked too.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	// Build output and Node tooling are not plugin code (and are not in tsconfig.json).
	globalIgnores(["node_modules", "main.js", ".test-build", "tools", "esbuild.config.mjs", "version-bump.mjs"]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: { allowDefaultProject: ["eslint.config.mjs", "manifest.json"] },
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
]);
