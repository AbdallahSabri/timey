"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { acceptInvitation } from "@/lib/actions/invitations";

/**
 * §8.1 Path B. Acceptance is one `SECURITY DEFINER` transaction inside
 * `accept_invitation()`; this only asks for it and reports what came back.
 *
 * Every refusal it can hit is already worded by the action — an expired token,
 * a consumed one, an account that already belongs to a company, and the
 * cross-account case ("this invitation was sent to X, but you are signed in as
 * Y", §8.4.1, deliberately lowercase because it continues the sentence the
 * reader is already in). All of them are rendered verbatim rather than
 * re-phrased here, where the reason is no longer known.
 */
export function AcceptInvitationButton({
  token,
  companyName,
}: {
  token: string;
  companyName: string;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    const result = await acceptInvitation(token);

    if (!result.ok) {
      toast.error(result.error);
      setIsPending(false);
      return;
    }

    // The account just left limbo (§8.3) and gained a company, so every cached
    // authenticated view was rendered under the old state.
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <Button type="button" onClick={handleClick} disabled={isPending}>
      {isPending ? "Joining…" : `Accept and join ${companyName}`}
    </Button>
  );
}
