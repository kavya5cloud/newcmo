// The trial used to live here, and deciding access here is what caused the bug this file
// now exists to prevent.
//
// isTrialActive(userId) answered "is this account inside its first 30 days", and three
// separate places called it as though that meant "may this account use the product". The
// moment a subscription existed those stopped being the same question — a paying account was
// let through by /api/generate and locked out by the screen in front of it, because the two
// asked different code.
//
// There is one answer now, in lib/billing/gate.ts:
//
//   import { accessForUser } from "@/lib/billing/gate";
//   const access = await accessForUser(userId);
//   if (!access.allowed) { ... }
//
// accessForUser understands subscriptions, cancelled-but-paid periods, and the grace window
// after a failed payment, none of which a date comparison can. The pure decision it wraps is
// in lib/billing/access.ts and is testable without a database.
//
// This file is deliberately left empty rather than deleted, so anyone who goes looking for
// the old function finds this note instead of writing it again.

export {};
