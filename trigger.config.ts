import { defineConfig } from "@trigger.dev/sdk/v3";
import { additionalFiles } from "@trigger.dev/build/extensions/core";
import { pythonExtension } from "@trigger.dev/python/extension";

export default defineConfig({
  // CUSTOMIZE: Replace with your Trigger.dev project ID from dashboard
  project: "proj_YOUR_PROJECT_ID",
  dirs: ["./src/trigger"],
  maxDuration: 60,
  legacyDevProcessCwdBehaviour: false,
  build: {
    extensions: [
      additionalFiles({
        files: ["./config/**", "./prompts/**", "./schemas/**", "./python/**/*.py"],
      }),
      pythonExtension({
        requirementsFile: "./requirements.txt",
      }),
    ],
  },
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
});
