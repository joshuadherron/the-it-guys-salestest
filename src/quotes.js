import { query, transaction, audit, json } from "./db.js";
import { ownerOnly, integer, fail } from "./security.js";
import { prospect } from "./pipeline.js";
import { discovery } from "./discovery.js";
import { answer, value } from "./discovery-rules.js";
import { platforms, oneOffItems, priceQuote } from "./pricing.js";

export async function priceConfig(c) {
  return Object.fromEntries(
    (
      await query(
        "SELECT * FROM config_prices" + (c ? " FOR UPDATE" : ""),
        [],
        c,
      )
    ).map((p) => [p.name, Number(p.amount)]),
  );
}

export function prefill(a) {
  const number = (id) => {
    const v = answer(a, id);
    return typeof v === "number" ? v : 0;
  };

  return {
    users:
      answer(a, "Q2.3") === "Same as employee count"
        ? number("Q2.1")
        : Number(value(a, "Q2.3")?.detail) || 0,
    windows: 0,
    mac: 0,
    ios: 0,
    android: 0,
    unallocated: number("Q2.2"),
    mailboxes: 0,
    dell: 0,
    phones: 0,
    locations:
      answer(a, "Q2.4") === "No" ? 1 : Number(value(a, "Q2.4")?.detail) || 0,
    locationLaborBase: null,
    oneOff: {},
    confirmed: false,
  };
}

export function validateInputs(body) {
  const input = {};

  for (const k of [
    "users",
    ...platforms,
    "mailboxes",
    "dell",
    "phones",
    "locations",
  ])
    input[k] = integer(body[k]);

  input.confirmed = body.confirmed === "yes";

  const locationLaborBase = body.locationLaborBase;
  if (
    locationLaborBase !== undefined &&
    locationLaborBase !== "" &&
    !/^\d+(\.\d{1,2})?$/.test(locationLaborBase)
  )
    fail("Enter a nonnegative additional-location labor base with at most two decimals.");
  input.locationLaborBase =
    locationLaborBase === "" || locationLaborBase === undefined
      ? null
      : Number(locationLaborBase);

  input.oneOff = {};

  for (const [i, label] of oneOffItems.entries()) {
    const selected = body["oneoff_" + i] === "yes";
    const amount = body["amount_" + i];

    if (
      amount !== undefined &&
      amount !== "" &&
      !/^\d+(\.\d{1,2})?$/.test(amount)
    )
      fail("Enter a nonnegative amount with at most two decimals.");

    input.oneOff[label] = {
      selected,
      amount: amount === "" || amount === undefined ? null : Number(amount),
    };
  }

  return input;
}

export function quotesRoutes(app) {
  app.get("/prospects/:id/quotes", async (req, res) => {
    const p = await prospect(req.params.id);
    const d = await discovery(p.id);

    const quotes = await query(
      "SELECT * FROM quotes WHERE prospect_id=? ORDER BY id DESC",
      [p.id],
    );

    const selected = req.query.quote
      ? quotes.find((q) => Number(q.id) === integer(req.query.quote))
      : quotes[0];
    if (req.query.quote && !selected)
      fail("Quote not found for this prospect.", 404);
    const input = selected ? json(selected.inputs) : prefill(d.answers);

    res.render("quotes", {
      p,
      quotes,
      selected,
      input,
      calculation: priceQuote(input, await priceConfig()),
      platforms,
      oneOffItems,
      stops: await query("SELECT * FROM config_stop_conditions ORDER BY id"),
    });
  });

  app.post("/prospects/:id/quotes/calculate", async (req, res) => {
    const p = await prospect(req.params.id);
    if (p.hold) fail("On Hold — Pending Josh Review. Pricing is blocked.");
    if (req.session.user.role !== "owner") fail("Owner access required.", 403);
    const input = validateInputs(req.body);
    res.render("quote-calculation", {
      calculation: priceQuote(input, await priceConfig()),
    });
  });

  app.post("/prospects/:id/quotes", async (req, res) => {
    await transaction(async (c) => {
      await query(
        "SELECT id FROM prospects WHERE id=? FOR UPDATE",
        [integer(req.params.id)],
        c,
      );

      const p = await prospect(req.params.id, c);

      if (p.hold) fail("On Hold — Pending Josh Review. Pricing is blocked.");

      const d = await discovery(p.id, c);

      const input =
        req.session.user.role === "owner"
          ? validateInputs(req.body)
          : prefill(d.answers);

      const calculation = priceQuote(input, await priceConfig(c));

      await query(
        "UPDATE quotes SET status='Draft',approved_by=NULL,approved_at=NULL WHERE prospect_id=? AND status='Approved'",
        [p.id],
        c,
      );

      const r = await query(
        "INSERT INTO quotes (prospect_id,inputs,line_items,total) VALUES (?,?,?,?)",
        [
          p.id,
          JSON.stringify(input),
          JSON.stringify(calculation.lines),
          calculation.total,
        ],
        c,
      );

      await audit(c, req.session.user, "create draft", "quote", r.insertId);
    });

    res.redirect(`/prospects/${req.params.id}`);
  });

  app.post("/quotes/:id/delete", ownerOnly, async (req, res) => {
    let pid;

    await transaction(async (c) => {
      let [q] = await query(
        "SELECT * FROM quotes WHERE id=?",
        [integer(req.params.id)],
        c,
      );

      if (!q) fail("Quote not found.", 404);

      pid = q.prospect_id;

      await query("SELECT id FROM prospects WHERE id=? FOR UPDATE", [pid], c);

      [q] = await query(
        "SELECT * FROM quotes WHERE id=? FOR UPDATE",
        [q.id],
        c,
      );

      if (!q) fail("Quote not found.", 404);
      if (q.status !== "Draft") fail("Only draft quotes can be deleted.");

      await query("DELETE FROM quotes WHERE id=?", [q.id], c);
      await audit(c, req.session.user, "delete draft", "quote", q.id);
    });

    res.redirect(`/prospects/${pid}`);
  });

  app.post("/quotes/:id/approve", ownerOnly, async (req, res) => {
    let pid;

    await transaction(async (c) => {
      let [q] = await query(
        "SELECT * FROM quotes WHERE id=?",
        [integer(req.params.id)],
        c,
      );

      if (!q) fail("Quote not found.", 404);

      pid = q.prospect_id;

      await query("SELECT id FROM prospects WHERE id=? FOR UPDATE", [pid], c);

      [q] = await query(
        "SELECT * FROM quotes WHERE id=? FOR UPDATE",
        [q.id],
        c,
      );

      const p = await prospect(pid, c);

      if (p.hold) fail("On Hold — Pending Josh Review");

      if (q.status !== "Draft") fail("Only a draft can be approved.");

      const input = json(q.inputs);

      if (!input.confirmed) {
        if (req.body.confirm_counts !== "yes")
          fail("Confirm the saved draft counts before approval.");
        input.confirmed = true;
      }

      const stops = await query(
        "SELECT * FROM config_stop_conditions ORDER BY id",
        [],
        c,
      );

      if (req.body.reviewed !== "yes")
        fail("Complete the stop-condition review.");

      if (stops.some((s) => req.body["stop_" + s.id] === "yes"))
        fail(
          "Targeted assessment first. A selected stop condition blocks approval.",
        );

      const calc = priceQuote(input, await priceConfig(c));

      if (calc.pending.length)
        fail("Priced by Josh: enter every selected one-off amount.");

      await query(
        "UPDATE quotes SET status='Approved',approved_by=?,approved_at=UTC_TIMESTAMP(),stop_review=?,inputs=?,line_items=?,total=? WHERE id=?",
        [
          req.session.user.email,
          JSON.stringify(
            stops.map((s) => ({
              id: s.id,
              label: s.label,
              status: s.status,
              selected: false,
            })),
          ),
          JSON.stringify(input),
          JSON.stringify(calc.lines),
          calc.total,
          q.id,
        ],
        c,
      );

      await audit(c, req.session.user, "approve", "quote", q.id);
    });

    res.redirect(`/prospects/${pid}`);
  });

  app.post("/quotes/:id/sent", ownerOnly, async (req, res) => {
    let pid;

    await transaction(async (c) => {
      let [q] = await query(
        "SELECT * FROM quotes WHERE id=?",
        [integer(req.params.id)],
        c,
      );

      if (!q) fail("Quote not found.", 404);

      pid = q.prospect_id;

      await query("SELECT id FROM prospects WHERE id=? FOR UPDATE", [pid], c);

      [q] = await query(
        "SELECT * FROM quotes WHERE id=? FOR UPDATE",
        [q.id],
        c,
      );

      if ((await prospect(pid, c)).hold) fail("On Hold — Pending Josh Review");

      if (q.status !== "Approved") fail("Approve the quote first.");

      await query("UPDATE quotes SET status='Sent' WHERE id=?", [q.id], c);

      await audit(c, req.session.user, "mark sent", "quote", q.id);
    });

    res.redirect(`/prospects/${pid}/quotes`);
  });

  app.get("/quotes/:id/print", async (req, res) => {
    let [q] = await query("SELECT * FROM quotes WHERE id=?", [
      integer(req.params.id),
    ]);

    if (!q) fail("Quote not found.", 404);

    res.render("quote-print", {
      q,
      p: await prospect(q.prospect_id),
      inputs: json(q.inputs),
      lines: json(q.line_items),
    });
  });
}
