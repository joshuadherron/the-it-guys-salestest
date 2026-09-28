import { groups, discussed } from "./discovery-rules.js";

export const screens = [
  "Business & Contact",
  "Environment & Pain",
  "Buying / Project Details",
];
export const sectionFor = (q) => (q.section === 1 ? 1 : q.section <= 6 ? 2 : 3);

export function requiredProgress(answers) {
  const items = groups.flatMap(([, ids]) => ids.map((id) => [id]));
  items.push(["Q1.3", "Q1.4"]);
  return {
    complete: items.filter((ids) => ids.some((id) => discussed(answers, id)))
      .length,
    total: items.length,
  };
}
