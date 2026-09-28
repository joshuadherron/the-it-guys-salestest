import "dotenv/config";
import express from "express";
import helmet from "helmet";
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import { db, query } from "./src/db.js";
import { csrf, requireUser } from "./src/security.js";
import { handoffRoutes, sp } from "./src/handoff.js";
import { adminRoutes } from "./src/admin.js";
import { quotesRoutes } from "./src/quotes.js";
import { discoveryRoutes } from "./src/discovery.js";
import { pipelineRoutes } from "./src/pipeline.js";
import { authRoutes } from "./src/auth.js";
export const app = express();
const mode = process.env.SHAREPOINT_WRITE_MODE || "dryrun";
if (!["dryrun", "live"].includes(mode))
  throw new Error("Invalid SHAREPOINT_WRITE_MODE");
if ((process.env.SESSION_SECRET || "").length < 32)
  throw new Error("SESSION_SECRET must contain at least 32 characters");
app.set("view engine", "ejs");
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "script-src": ["'self'"],
        "upgrade-insecure-requests":
          process.env.NODE_ENV === "production" ? [] : null,
      },
    },
  }),
);
app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.csrf = "";
  res.locals.mode = mode;
  res.set("Cache-Control", "no-store");
  next();
});
app.use(express.static("public"));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.use(express.json({ limit: "256kb" }));
const MySQLStore = MySQLStoreFactory(session);
app.use(
  session({
    name: "tig.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new MySQLStore({ createDatabaseTable: false }, db),
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);
app.use(csrf);
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.mode = mode;
  next();
});
authRoutes(app);
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use(requireUser);
app.use(async (req, res, next) => {
  const [user] = await query(
    "SELECT email,role FROM allowlist WHERE email=? AND enabled=TRUE",
    [req.session.user.email],
  );
  if (!user)
    return req.session.destroy(() => res.status(403).send("Access revoked."));
  req.session.user = user;
  res.locals.user = user;
  res.set("Cache-Control", "no-store");
  next();
});
pipelineRoutes(app);
discoveryRoutes(app);
quotesRoutes(app);
handoffRoutes(app);
adminRoutes(app);
app.use((err, req, res, _next) => {
  const status = err.status || 500;

  if (status >= 500) {
    console.error("Unhandled application error:", {
      method: req.method,
      path: req.originalUrl,
      name: err?.name,
      message: err?.message,
      code: err?.code,
      sqlState: err?.sqlState,
      stack: err?.stack,
    });
  }

  res.status(status);

  const message =
    status < 500
      ? err.message
      : "The action could not be completed. Check the server console for details.";

  if (req.is("application/json")) {
    return res.json({ error: message });
  }

  res.render("error", { message });
});
const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log("Sales app listening.");

  sp.check()
    .then((schema) => {
      if (schema.errors?.length) {
        console.warn(
          "SharePoint schema check completed with errors:",
          schema.errors.join(" "),
        );
      } else {
        console.log("SharePoint schema check passed.");
      }
    })
    .catch((err) => {
      console.error("SharePoint startup check failed:", err.message);
    });
});