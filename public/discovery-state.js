// Presentation-only state inference. The server remains the validation authority.
export function inferredState(type, value, fallback = "not_discussed") {
  const filled = (v) =>
    v !== null && v !== undefined && String(v).trim() !== "";
  let present;
  if (type === "multi") present = value.length > 0;
  else if (type === "matrix")
    present = Object.values(value).some((c) => c.state !== "not_discussed");
  else if (type === "apps")
    present =
      value.none || value.entries.some((e) => filled(e.name) || filled(e.use));
  else if (type === "volume") present = filled(value.amount);
  else if (type === "billing") present = value.same || filled(value.answer);
  else
    present = filled(value && typeof value === "object" ? value.answer : value);
  return present ? "answered" : fallback;
}
