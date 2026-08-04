/**
 * A job's ticket numbers.
 *
 * One job routinely answers to more than one: the company raises a second
 * under a different queue, or a revisit is tracked separately and the customer
 * wants both quoted back.
 *
 * The first is the primary and lives on `Job.ticketNumber` — it is what every
 * report, export and change request already means by "the ticket", and moving
 * it would have been a rewrite of all of them for no gain. The rest are
 * `JobTicket` rows in the order they were added. One field, one meaning.
 */

export type TicketSource = {
  ticketNumber: string | null;
  extraTickets?: { number: string; order: number }[];
};

/** Every ticket on the job, primary first, blanks dropped. */
export function jobTickets(job: TicketSource): string[] {
  const extras = [...(job.extraTickets ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((ticket) => ticket.number.trim())
    .filter(Boolean);

  const primary = job.ticketNumber?.trim();
  return primary ? [primary, ...extras] : extras;
}

/**
 * How they read on anything that goes outside: "S-542975, S-542976".
 *
 * Comma separated because that is what the people receiving these asked for,
 * and because a single field is what their systems paste into.
 */
export function ticketList(job: TicketSource): string | null {
  const tickets = jobTickets(job);
  return tickets.length > 0 ? tickets.join(", ") : null;
}

/** What each one is called internally, in order. */
export function ticketRole(index: number): string {
  if (index === 0) return "Primary";
  if (index === 1) return "Secondary";
  return `Ticket ${index + 1}`;
}
