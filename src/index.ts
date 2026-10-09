import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3003);
serve({ fetch: createApp().fetch, port, hostname: "127.0.0.1" });
console.log(`API de roteiros em http://127.0.0.1:${port}`);
