// Commercial document dates use the business's America/Chicago calendar day.
const zone = "America/Chicago";
export function chicagoDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2} \\d{2}:/.test(value) ? value.replace(" ", "T") + "Z" : value);
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid quote date");
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const part = key => parts.find(p=>p.type===key)?.value;
  return part("year")+"-"+part("month")+"-"+part("day");
}
export function chicagoLongDate(value = new Date()) {
  const day = chicagoDate(value);
  return new Date(day+"T12:00:00Z").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"});
}
