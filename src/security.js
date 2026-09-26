import crypto from "node:crypto";
export function requireUser(req, res, next) {
  if (!req.session.user) return res.redirect("/auth/login");
  next();
}
export function ownerOnly(req, res, next) {
  if (req.session?.user?.role !== "owner")
    return res.status(403).send("Owner access required.");
  next();
}
export function csrf(req, res, next) {
  req.session.csrf ||= crypto.randomBytes(32).toString("hex");
  res.locals.csrf = req.session.csrf;
  if (req.method === "POST") {
    const supplied = req.get("x-csrf-token") || req.body?._csrf;
    const expected = req.session.csrf;
    if (
      typeof supplied !== "string" ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    )
      return res.status(403).send("Invalid form token. Reload and try again.");
  }
  next();
}
const attempts = new Map();
export function loginLimit(req, res, next) {
  const now = Date.now();
  for (const [key, x] of attempts) if (x.until < now) attempts.delete(key);
  const record = attempts.get(req.ip) || { count: 0, until: now + 60000 };
  record.count++;
  attempts.set(req.ip, record);
  if (record.count > 20)
    return res.status(429).send("Please wait before trying sign-in again.");
  next();
}
export function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
export function text(value, max = 10000) {
  if (typeof value !== "string" || value.length > max)
    fail("Invalid text value.");
  return value.trim();
}
export function integer(value, max = 100000) {
  if (!/^\d+$/.test(String(value)) || Number(value) > max)
    fail("Enter a nonnegative whole number.");
  return Number(value);
}
export function choice(value, choices) {
  if (!choices.includes(value)) fail("Select a valid option.");
  return value;
}
export function date(value) {
  if (!value) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(new Date(value).getTime()) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail("Invalid date.");
  return value;
}
