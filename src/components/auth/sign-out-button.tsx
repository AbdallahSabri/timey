"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/actions/auth";

type SignOutButtonProps = {
  /** Where to land once the session is gone. Public routes only. */
  redirectTo?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  children?: React.ReactNode;
};

export function SignOutButton({
  redirectTo = "/",
  variant = "outline",
  size = "sm",
  className,
  children = "Sign out",
}: SignOutButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    const result = await signOut();

    if (!result.ok) {
      toast.error(result.error);
      setIsPending(false);
      return;
    }

    router.replace(redirectTo);
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={isPending}
      onClick={handleClick}
    >
      {isPending ? "Signing out…" : children}
    </Button>
  );
}
