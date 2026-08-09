// ─── Local port allocation & server identity ─────────────────────────────────
//
// Expense Track and TimeTrack are both Electron apps that front a local Express
// server. Both previously hard-coded port 5000. When TimeTrack was already
// running it owned 5000, this app's listen() failed, and the readiness poll was
// answered by *TimeTrack's* server — so the window loaded TimeTrack's UI and it
// looked like "TimeTrack opens instead". Allocating a free port at launch makes
// that collision structurally impossible; the identity check below makes it
// impossible to render a foreign server even if a port is somehow reused.
//
// Extracted from main.cjs so it can be exercised by the automated test suite
// without booting Electron.

const net = require("net");
const http = require("http");

// A private, deliberately uncommon range tried first so the port stays stable
// across launches (nicer for firewall prompts and debugging). If every
// candidate is taken we fall back to an OS-assigned ephemeral port.
const PREFERRED_PORTS = [5731, 5732, 5733, 5734, 5735, 5736, 5737, 5738];

const APP_IDENTITY = "expense-track";

function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.once("listening", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.listen(0, "127.0.0.1");
  });
}

async function allocateFreePort() {
  for (const candidate of PREFERRED_PORTS) {
    if (await isPortFree(candidate)) return candidate;
  }
  return ephemeralPort();
}

// Defence in depth: never render a server we cannot prove is ours.
function fetchHealth(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/health", timeout: 2000 },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          // Refuse to buffer an unbounded response from an unknown server.
          if (body.length > 8192) req.destroy(new Error("Health response too large."));
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Health endpoint returned malformed JSON."));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Health check timed out.")));
    req.on("error", reject);
  });
}

// Resolves when the server on `port` is up AND identifies as Expense Track.
// Rejects immediately if a different application answers.
function waitForOwnServer(port, timeoutMs = 15000, intervalMs = 200) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = setInterval(async () => {
      let health;
      try {
        health = await fetchHealth(port);
      } catch {
        if (Date.now() - start > timeoutMs) {
          clearInterval(poll);
          reject(new Error("Server did not respond after 15 seconds."));
        }
        return;
      }
      clearInterval(poll);
      if (health && health.app === APP_IDENTITY) {
        resolve(health);
      } else {
        const reported = health && health.app ? health.app : "unknown";
        reject(
          new Error(
            `Port ${port} is served by a different application (reported "${reported}"). ` +
              `Expense Track will not attach to it.`,
          ),
        );
      }
    }, intervalMs);
  });
}

module.exports = {
  PREFERRED_PORTS,
  APP_IDENTITY,
  isPortFree,
  ephemeralPort,
  allocateFreePort,
  fetchHealth,
  waitForOwnServer,
};
