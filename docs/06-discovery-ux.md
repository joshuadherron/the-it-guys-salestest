# Discovery UX

The discovery presentation now has three sections: Business & Contact (original question section 1), Environment & Pain (2–6), and Buying / Project Details (7–8, plus review/send). Original question IDs, schema sections and saved cells are unchanged. Old review URLs still redirect to section 3.

Answer fields are immediately available. Editing a value infers Answered; clearing returns to Not discussed, or to a previously selected explicit non-answer state. Change status exposes all existing states: Answered, Not sure and Not discussed. Selecting a non-answer state clears the visible answer controls, matching the existing saved null value. Question guidance remains collapsed.

Text edits autosave after 500 ms; change events save immediately. Section navigation and form submissions flush pending edits and wait for the serialized revision-aware save queue. Validation failures prevent navigation. A revision conflict blocks further saves until reload. The server still validates every answer and enforces existing ownership and hold rules.

Progress uses the existing MVD groups and discussed predicate, counting phone-or-email as one required item. Missing groups and Send to Josh readiness update from server responses. Optional questions do not add requirements. No discovery schema, validation, flags, handoff rules or database migration changed.

Regression tests cover state inference, explicit states, autosave/navigation/reload, invalid answers, revision conflicts, MVD progress and all three section renders. Tests use synthetic data and a browser-controller harness; no live database or SharePoint calls are made.
