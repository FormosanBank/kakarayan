import {defineConfig, devices} from "@playwright/test";

const remoteApi = process.env.PLAYWRIGHT_API_MODE === "remote";
const siteServer = {
  command: "npm run preview -- --host 127.0.0.1 --port 4173",
  url: "http://127.0.0.1:4173/kakarayan/",
  reuseExistingServer: !process.env.CI,
};
const webServers = remoteApi
  ? [siteServer]
  : [
      {
        command: "cd .. && KAKARAYAN_DB_PATH=build/fixture-release/formosanbank.sqlite KAKARAYAN_RELEASE_MANIFEST_PATH=build/fixture-release/release-manifest.json KAKARAYAN_CORS_ORIGINS=http://127.0.0.1:4173 KAKARAYAN_REQUESTS_PER_MINUTE=60000 KAKARAYAN_REQUEST_BURST=60000 KAKARAYAN_EXPORTS_PER_MINUTE=60000 KAKARAYAN_EXPORT_BURST=60000 uv run uvicorn api.app:app --host 127.0.0.1 --port 8000 --no-access-log",
        url: "http://127.0.0.1:8000/readyz",
        reuseExistingServer: !process.env.CI,
      },
      siteServer,
    ];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173/kakarayan/",
    trace: "retain-on-failure",
  },
  webServer: webServers,
  projects: [
    {
      name: "desktop-chromium",
      use: {...devices["Desktop Chrome"]},
    },
    {
      name: "mobile-chromium",
      use: {...devices["Pixel 7"]},
    },
    {
      name: "desktop-firefox",
      use: {...devices["Desktop Firefox"]},
    },
    {
      name: "desktop-webkit",
      use: {...devices["Desktop Safari"]},
    },
  ],
});
