import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "50000b",  // 50,000 bytes — test sends 51,000+ char body to verify 413
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "50000b" }));

// Catch body-too-large errors immediately, before any other middleware
// (must be a 4-argument function to be treated as an error handler by Express)
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err.type === "entity.too.large" || err.status === 413) {
    return res.status(413).json({ error: "Request body too large (50kb limit)" });
  }
  next(err);
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }

    // Handle body-too-large gracefully (PayloadTooLargeError from express.json limit)
    if (err.type === "entity.too.large" || err.status === 413) {
      return res.status(413).json({ error: "Request body too large (50kb limit)" });
    }

    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Serve on the port specified by the PORT environment variable.
  //
  // In the packaged desktop app the Electron main process allocates a free
  // port at launch and passes it in, so Expense Track never contends with
  // another locally running Electron app (e.g. TimeTrack) for a fixed port.
  // 5000 remains the default for `npm run dev` only.
  const port = parseInt(process.env.PORT || "5000", 10);

  // Bind to loopback only. This is a single-user desktop application; there is
  // no reason to expose the API and SQLite-backed data on every interface.
  // Override with HOST if a non-desktop deployment ever needs it.
  const host = process.env.HOST || "127.0.0.1";

  // Fail loudly on a port collision instead of leaving the caller to poll a
  // port that is answered by some *other* process.
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[expense-track] Port ${port} on ${host} is already in use by another process. ` +
          `Refusing to start so the app cannot attach to a foreign server.`,
      );
      process.exit(1);
    }
    throw err;
  });

  httpServer.listen(
    {
      port,
      host,
      // reusePort is not supported on Windows — omit it for cross-platform compat
    },
    () => {
      log(`serving on ${host}:${port}`);
    },
  );
})();
