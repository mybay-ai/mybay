import crypto from "crypto";

export interface SessionCompleteTicket {
  slug: string;
  hermesCookies: string[];
  redirectUrl: string;
  expiresAt: number;
  mybaySessionToken?: string;
}

const ticketStore = new Map<string, SessionCompleteTicket>();

function cleanupTickets() {
  const now = Date.now();
  for (const [key, ticket] of ticketStore.entries()) {
    if (ticket.expiresAt < now) ticketStore.delete(key);
  }
}

export function createSessionCompleteTicket(slug: string, hermesCookies: string[], redirectUrl: string, mybaySessionToken?: string): string {
  cleanupTickets();
  const ticket = crypto.randomBytes(32).toString("hex");
  ticketStore.set(ticket, {
    slug,
    hermesCookies,
    redirectUrl,
    expiresAt: Date.now() + 60 * 1000,
    mybaySessionToken,
  });
  return ticket;
}

export function getSessionCompleteTicket(ticket: string) {
  cleanupTickets();
  return ticketStore.get(ticket);
}

export function deleteSessionCompleteTicket(ticket: string) {
  ticketStore.delete(ticket);
}
