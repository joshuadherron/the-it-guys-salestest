export function canQuote(user, permission) {
  if(user?.enabled===false||user?.enabled===0)return false;
  const value = user && ({ "quote.approve": user.quote_approve, "quote.send": user.quote_send, admin: user.is_admin })[permission];
  return value === true || value === 1;
}
export function requireQuotePermission(permission) {
  const middleware = (req, res, next) => canQuote(req.session?.user, permission)
    ? next() : res.status(403).send("Permission required: " + permission);
  middleware.permission = permission;
  return middleware;
}
export const quoteApprove = requireQuotePermission("quote.approve");
export const quoteSend = requireQuotePermission("quote.send");
export const adminOnly = requireQuotePermission("admin");
