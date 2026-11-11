import { getSessionUser } from "@/lib/session";
import { approvalsBadge } from "@/lib/waiting";

/**
 * The Approvals tab's count, asked for again by the tab bar after each
 * navigation.
 *
 * The app shell renders the count once, and the shell is not rendered again
 * as somebody moves between its pages — so on its own the number would stay
 * whatever it was when they arrived, while they approved the very things it
 * was counting.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return new Response(null, { status: 401 });

  return Response.json(await approvalsBadge(user), {
    headers: { "Cache-Control": "no-store" },
  });
}
