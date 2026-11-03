// Server-side development setup. Start an agent on the selected Atem first.
import express from "express";
import { chiselMiddleware } from "@agora-build/chisel-dev/middleware";

const app = express();
app.use(express.json({ limit: "12mb" }));
chiselMiddleware(app, {
  srcDirs: ["src"],
  station: {
    origin: "https://station.agora.build",
    integrationId: "YOUR_INTEGRATION_ID",
    hostId: "YOUR_ATEM_DEVICE_ID",
    sessionId: "ses-REPLACE_WITH_TARGET_SESSION",
    routeId: "ui",
    routeRevision: 1,
    tokenEnv: "CHISEL_STATION_TOKEN",
  },
});
// Supply CHISEL_STATION_TOKEN in the server environment. Never use a VITE_ or
// NEXT_PUBLIC_ credential variable. The Station grant and runtime route must
// explicitly allow this service. The separate host-work-api rollout gate must
// pass its permission, verifier, consent and live acceptance checks first.
app.listen(3000, "127.0.0.1");
