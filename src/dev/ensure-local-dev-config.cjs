const { ensureLocalDevConfig } = require("./dev-local-config.cjs");

async function main() {
  const result = await ensureLocalDevConfig(process.cwd());
  const runtime = result.runtime;

  console.log(result.created ? "Created local dev config." : "Using existing local dev config.");
  console.log(`  config: ${runtime.configPath}`);
  console.log(`  devPort: ${runtime.devPort}`);
  console.log(`  playwrightUserDataDir: ${runtime.playwrightUserDataDir}`);
  console.log(`  playwrightArtifactDir: ${runtime.playwrightArtifactDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
