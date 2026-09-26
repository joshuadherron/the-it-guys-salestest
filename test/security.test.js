import test from "node:test";
import assert from "node:assert/strict";
import { ownerOnly, csrf } from "../src/security.js";
import { adminRoutes } from "../src/admin.js";
import { quotesRoutes } from "../src/quotes.js";
import { discoveryRoutes } from "../src/discovery.js";
import { handoffRoutes } from "../src/handoff.js";
function response() {
  return {
    code: 200,
    status(code) {
      this.code = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    locals: {},
  };
}
test("owner middleware refuses sales and anonymous users", () => {
  for (const role of [undefined, "sales"]) {
    const res = response();
    let passed = false;
    ownerOnly({ session: { user: { role } } }, res, () => (passed = true));
    assert.equal(res.code, 403);
    assert.equal(passed, false);
  }
  let passed = false;
  ownerOnly(
    { session: { user: { role: "owner" } } },
    response(),
    () => (passed = true),
  );
  assert.equal(passed, true);
});
test("every registered owner-only route enforces role before handler", () => {
  const routes = [];
  const app = {
    get: (path, ...handlers) => routes.push({ path, handlers }),
    post: (path, ...handlers) => routes.push({ path, handlers }),
  };
  for (const register of [
    adminRoutes,
    quotesRoutes,
    discoveryRoutes,
    handoffRoutes,
  ])
    register(app);
  const protectedRoutes = routes.filter(
    (r) =>
      r.path.startsWith("/admin") ||
      /approve|sent|reopen|release|mark-lost|reconcile/.test(r.path),
  );
  assert.equal(protectedRoutes.length, 12);
  for (const r of protectedRoutes) {
    assert.equal(r.handlers[0], ownerOnly, r.path);
    const res = response();
    r.handlers[0]({ session: { user: { role: "sales" } } }, res, () =>
      assert.fail("Sales entered " + r.path),
    );
    assert.equal(res.code, 403);
  }
});
test("POST requires CSRF; GET establishes token; Unicode token cannot bypass", () => {
  const req = { session: {}, method: "GET", get: () => undefined };
  const res = response();
  csrf(req, res, () => {});
  assert.equal(req.session.csrf.length, 64);
  req.method = "POST";
  req.body = {};
  csrf(req, res, () => assert.fail());
  assert.equal(res.code, 403);
  req.body._csrf = req.session.csrf;
  let ok = false;
  csrf(req, response(), () => (ok = true));
  assert.ok(ok);
  req.body._csrf = "é".repeat(64);
  assert.doesNotThrow(() => csrf(req, response(), () => assert.fail()));
});


test("sales cannot call owner handoff actions through the shared route", async()=>{
  const routes=[];const app={get:()=>{},post:(path,...handlers)=>routes.push({path,handlers})};handoffRoutes(app);
  const handler=routes.find(r=>r.path==='/prospects/:id/handoff').handlers[0];
  for(const action of ['Quoting','TechnicalAssessment'])await assert.rejects(handler({body:{action},session:{user:{role:'sales'}}},response()),e=>e.status===403);
});
