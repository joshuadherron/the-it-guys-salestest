import { fail } from "../security.js";
export const DEFAULT_SUBJECT = "Your Managed IT quote from The IT Guys - {QuoteId}";
export const DEFAULT_BODY = "Hi {FirstName}, attached is your Managed IT quote ({MonthlyTotal}/month, {Onboarding} one-time onboarding). To accept, simply reply to this email saying you accept. We'll then send the Master Services Agreement and Client Service Schedule{BAA phrase} for electronic signature. The quote is valid for 30 days. - {SenderName}, {SenderTitle}, The IT Guys LLC, {SenderPhone}";
export const sendMode = (env = process.env) => {
  const mode = env.QUOTE_SEND_MODE || "dryrun";
  if (!["off", "dryrun", "live"].includes(mode)) fail("Invalid QUOTE_SEND_MODE.");
  return mode;
};
export function email(value, label = "email address") {
  const result = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (result.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(result)) fail("Enter a valid " + label + ".");
  return result;
}
export function senderMailbox(env = process.env) {
  const box = email(env.QUOTE_SENDER_MAILBOX, "QUOTE_SENDER_MAILBOX (shared mailbox)");
  if (!box.endsWith("@theitguys.us") || ["workflow@theitguys.us", "josh@theitguys.us", "alanna@theitguys.us"].includes(box))
    fail("QUOTE_SENDER_MAILBOX must be a dedicated shared mailbox; workflow@ and personal mailboxes are forbidden.");
  return box;
}
export function senderProfile(user) {
  for (const key of ["display_name", "sender_title", "sender_phone"])
    if (typeof user?.[key] !== "string" || !user[key].trim() || /[\r\n]/.test(user[key])) fail("Sender profile is incomplete: " + key + ". Ask an admin to complete it.");
  return user;
}
export function recipients(prospect, actor, mode, input = {}) {
  const to = email(prospect.email, "primary contact email");
  if (to.endsWith("@theitguys.us") && input.internal_test !== "yes") fail("Internal recipient requires the internal test checkbox.");
  const cc = input.cc ? email(input.cc, "single CC address") : null;
  return { to: mode === "dryrun" ? email(actor.email) : to, cc: mode === "dryrun" ? null : cc, intendedTo: to };
}
export function inspectPdfText(text) {
  if (typeof text !== "string" || !text.trim()) fail("The PDF text could not be verified; send is blocked.");
  if (/[\[\]]/.test(text) || /\b(?:TEMPLATE|DRYRUN)\b/i.test(text)) fail("The PDF still contains a placeholder, TEMPLATE or DRYRUN. Review it in Word first.");
}
const TOKENS = ["QuoteId", "FirstName", "MonthlyTotal", "Onboarding", "BAA phrase", "SenderName", "SenderTitle", "SenderPhone"];
export function validateEmailTemplate(subject, body) {
  if (!subject?.trim() || subject.length > 250 || /[\r\n]/.test(subject) || !body?.trim() || body.length > 12000) fail("Invalid quote email template.");
  for(const required of TOKENS) if(!(subject+body).includes("{"+required+"}")) fail("Email template must retain token: "+required);
  for(const required of ["SenderName","SenderTitle","SenderPhone"]) if(!body.includes("{"+required+"}")) fail("Email body must name the sender: "+required);
  for (const token of (subject + body).matchAll(/\{([^{}]+)\}/g)) if (!TOKENS.includes(token[1])) fail("Unsupported email template token: " + token[1]);
}
export function quoteEmail({ quote, prospect, actor, fields, config, mode, to, cc, pdf, name, requestId }) {
  senderProfile(actor);
  if(fields["ENG.QuoteId"]){
    if(!quote.quote_number)fail("Stored quote number is missing. Open the quote preview before sending.");
    if(!fields["ENG.Scope"]||!fields["ENG.Terms"]||!fields["ENG.OneTimeTotal"])fail("Approved project scope, terms and totals are required.");
    return {message:{subject:(mode==="dryrun"?"[DRYRUN] ":"")+"Your project quote from The IT Guys - "+quote.quote_number,
      body:{contentType:"Text",content:`Hi ${prospect.contact_name?.trim().split(/\s+/)[0]||"there"}, attached is project quote ${quote.quote_number}. Please review its scope, prices and terms. You can reply accepting the quote and referencing ${quote.quote_number}.\n\n${actor.display_name}, ${actor.sender_title}\nThe IT Guys LLC\n${actor.sender_phone}`},
      toRecipients:[{emailAddress:{address:to}}],ccRecipients:cc?[{emailAddress:{address:cc}}]:[],
      attachments:[{"@odata.type":"#microsoft.graph.fileAttachment",name,contentType:"application/pdf",contentBytes:pdf.toString("base64")}],
      internetMessageHeaders:[{name:"x-tig-quote-attempt",value:requestId}]},saveToSentItems:true};
  }
  const subject = config?.subject_template || DEFAULT_SUBJECT, body = config?.body_template || DEFAULT_BODY;
  validateEmailTemplate(subject, body);
  const values = { QuoteId: quote.quote_number, FirstName: prospect.contact_name?.trim().split(/\s+/)[0] || "there", MonthlyTotal: fields["MIT.MonthlyTotal"], Onboarding: fields["MIT.Onboarding"], "BAA phrase": fields["MIT.BAAAccept"] || "", SenderName: actor.display_name, SenderTitle: actor.sender_title, SenderPhone: actor.sender_phone };
  if (!values.QuoteId || !values.MonthlyTotal || !values.Onboarding) fail("Filled quote totals are missing.");
  const render = text => text.replace(/\{([^{}]+)\}/g, (_, key) => values[key]);
  return { message: { subject: (mode === "dryrun" ? "[DRYRUN] " : "") + render(subject), body: { contentType: "Text", content: render(body) }, toRecipients: [{ emailAddress: { address: to } }], ccRecipients: cc ? [{ emailAddress: { address: cc } }] : [], attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name, contentType: "application/pdf", contentBytes: pdf.toString("base64") }], internetMessageHeaders: [{ name: "x-tig-quote-attempt", value: requestId }] }, saveToSentItems: true };
}
