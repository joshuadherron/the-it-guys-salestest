import { graph } from "./graph.js";
import { SharePoint } from "./sharepoint.js";

export const sp = new SharePoint(graph);

export const lookupId = (email) =>
  email === "alanna@theitguys.us"
    ? process.env.SP_ALANNA_USER_LOOKUP_ID
    : email === "josh@theitguys.us"
      ? process.env.SP_JOSH_USER_LOOKUP_ID
      : undefined;
