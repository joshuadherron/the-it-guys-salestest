import { schema, format, flags, mvd } from "./discovery-rules.js";

export function discoverySnapshot(
  p,
  d,
  {
    capturedBy = null,
    releasedBy = null,
    releaseNote = null,
    at = new Date(),
  } = {},
) {
  return {
    form: "BII Business Discovery Form v0.3 + v0.4 corrections",
    opportunityId: p.opp,
    status: d.status,
    revision: d.revision,
    capturedBy,
    exportedAt: at.toISOString(),
    mvdComplete: mvd(d.answers).length === 0,
    flags: [...new Set(flags(d.answers).map((flag) => flag.code))],
    hold: { onHold: Boolean(p.hold), releasedBy, releaseNote },
    answers: Object.fromEntries(
      schema.map((q) => {
        const cell = d.answers[q.id] || { state: "not_discussed", value: null };
        const value =
          cell.state !== "answered"
            ? null
            : q.type === "apps" && !cell.value?.none
              ? structuredClone(cell.value.entries)
              : format(cell);
        return [q.id, { label: q.label, state: cell.state, value }];
      }),
    ),
  };
}
