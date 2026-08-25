"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createInvitation } from "@/lib/actions/invitations";
import { cn } from "@/lib/utils";
import {
  inviteMemberSchema,
  type InviteMemberInput,
  type InviteMemberValues,
} from "@/lib/validations/invitations";

/** Matches `Input`'s surface so the native select reads as one of the family. */
const selectClassName =
  "border-input focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm";

type MintedInvitation = { email: string; path: string };

/**
 * The link is assembled from `window.location.origin` at render time rather
 * than from the request headers on the server. `createInvitation` returns the
 * path's token and nothing else — a server action has no dependable view of the
 * origin behind a proxy, where `Host` and `X-Forwarded-*` are whatever the
 * deployment says they are, while the browser already knows the URL the admin
 * is reading this on. This block only ever renders after a client-side submit,
 * so there is no server pass to disagree with.
 */
function InviteLink({ invitation }: { invitation: MintedInvitation }) {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window === "undefined"
      ? invitation.path
      : `${window.location.origin}${invitation.path}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy the link. Select it and copy it manually.");
    }
  }

  return (
    <div className="border-border bg-muted/40 flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">
          Invitation link for {invitation.email}
        </p>
        <p className="text-muted-foreground text-sm">
          Share this link directly — email delivery isn&apos;t set up yet. It
          appears once: leaving this page loses it, and a lost link means
          revoking the invitation and sending a new one.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={url}
          aria-label="Invitation link"
          className="font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => void copy()}
          aria-label="Copy invitation link"
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

/**
 * §8.4. Re-inviting an address replaces its outstanding invitation rather than
 * stacking a second one — that happens in the action, so nothing here has to
 * ask whether one already exists.
 */
export function InviteMemberForm() {
  const router = useRouter();
  const [invitation, setInvitation] = useState<MintedInvitation | null>(null);

  const form = useForm<InviteMemberInput, unknown, InviteMemberValues>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: "", role: "employee" },
  });

  const {
    formState: { errors, isSubmitting },
  } = form;

  async function onSubmit(values: InviteMemberValues) {
    const result = await createInvitation(values);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    // The raw token exists nowhere but this variable — only its SHA-256 was
    // stored (§8.4). It is put on screen and never logged.
    setInvitation({
      email: values.email,
      path: `/invite/${result.data.token}`,
    });
    form.reset({ email: "", role: values.role });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <Field
              className="flex-1"
              data-invalid={errors.email ? true : undefined}
            >
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                placeholder="teammate@example.com"
                aria-invalid={errors.email ? true : undefined}
                {...form.register("email")}
              />
              <FieldError errors={errors.email ? [errors.email] : undefined} />
            </Field>

            <Field
              className="sm:w-44"
              data-invalid={errors.role ? true : undefined}
            >
              <FieldLabel htmlFor="invite-role">Role</FieldLabel>
              <select
                id="invite-role"
                className={cn(selectClassName)}
                aria-invalid={errors.role ? true : undefined}
                {...form.register("role")}
              >
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
              {errors.role ? (
                <FieldError errors={[errors.role]} />
              ) : (
                <FieldDescription>Admins manage the company.</FieldDescription>
              )}
            </Field>
          </div>

          <Button type="submit" className="self-start" disabled={isSubmitting}>
            {isSubmitting ? "Creating invitation…" : "Create invitation"}
          </Button>
        </FieldGroup>
      </form>

      {invitation ? <InviteLink invitation={invitation} /> : null}
    </div>
  );
}
