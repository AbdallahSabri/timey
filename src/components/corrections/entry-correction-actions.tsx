"use client";

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { AdminEditEntryDialog } from "@/components/corrections/admin-edit-entry-dialog";
import { AmendCorrectionDialog } from "@/components/corrections/amend-correction-dialog";
import { DeleteCorrectionDialog } from "@/components/corrections/delete-correction-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Project } from "@/lib/actions/projects";
import type { TimeEntryWithLabels } from "@/lib/actions/time-entries";

type OpenDialog = "amend" | "delete" | "admin-edit" | null;

/**
 * Everything a person may do to one of their own **closed** entries, which is
 * §7.1's table read back as a menu.
 *
 * **What is absent is the specification.** There is no "Edit times" item, at any
 * role, because there is no path in the product that lets an employee change a
 * closed entry's times: the RLS UPDATE policy allows the owner to update only
 * while `ended_at IS NULL` (§7.2), so such a control could do nothing but
 * produce a permission error. What it offers instead is the two requests §7.1
 * routes to — change and deletion — and, for an admin, §7.4's direct edit, which
 * is a different mechanism rather than the same one with the queue skipped.
 *
 * **The caller renders this only on closed rows** (`entry-list.tsx`), and that
 * is not styling either. A running entry's controls are stop and discard; it has
 * no end time to correct yet, and `admin_edit_entry()` refuses a running row
 * outright. `entry.endedAt === null` is re-checked here anyway, because a menu
 * that appeared on a running row would be a bug in whichever caller forgot.
 *
 * The dialogs are rendered as siblings of the menu with their open state held
 * here: a `DialogTrigger` nested inside a `DropdownMenuItem` unmounts with the
 * menu on select, which closes the dialog in the same frame it opens.
 */
export function EntryCorrectionActions({
  entry,
  projects,
  timezone,
  canAdminEdit,
}: {
  entry: TimeEntryWithLabels;
  projects: Project[];
  timezone: string | null;
  canAdminEdit: boolean;
}) {
  const [open, setOpen] = useState<OpenDialog>(null);

  if (entry.endedAt === null) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Correct this entry"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setOpen("amend");
            }}
          >
            Request a change…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setOpen("delete");
            }}
          >
            Request deletion…
          </DropdownMenuItem>
          {canAdminEdit ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setOpen("admin-edit");
                }}
              >
                Edit directly (admin)…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AmendCorrectionDialog
        entry={entry}
        projects={projects}
        timezone={timezone}
        open={open === "amend"}
        onOpenChange={(next) => setOpen(next ? "amend" : null)}
      />

      <DeleteCorrectionDialog
        entry={entry}
        timezone={timezone}
        open={open === "delete"}
        onOpenChange={(next) => setOpen(next ? "delete" : null)}
      />

      {canAdminEdit ? (
        <AdminEditEntryDialog
          entry={entry}
          projects={projects}
          timezone={timezone}
          open={open === "admin-edit"}
          onOpenChange={(next) => setOpen(next ? "admin-edit" : null)}
        />
      ) : null}
    </>
  );
}
