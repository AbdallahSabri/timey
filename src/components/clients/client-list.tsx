"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ArchiveDialog } from "@/components/structure/archive-dialog";
import { DataCard, DataCardList } from "@/components/structure/data-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { archiveClient } from "@/lib/actions/clients";
import type { Client } from "@/lib/actions/clients";
import { cn } from "@/lib/utils";

/**
 * `canManage` decides whether the archive control renders. It is a convenience,
 * not the boundary — `clients_update_admin` refuses a non-admin regardless, and
 * `archiveClient` surfaces that refusal verbatim.
 *
 * There is no restore control for an archived row, and none is missing:
 * archiving frees the name under the partial unique index, so un-archiving is
 * not a safe one-click action (`SPEC.md` §3.3, §3.11).
 */
export function ClientList({
  clients,
  canManage,
  showArchived,
}: {
  clients: Client[];
  canManage: boolean;
  showArchived: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function archive(client: Client) {
    setPendingId(client.id);
    const result = await archiveClient(client.id);
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`${client.name} has been archived.`);
    router.refresh();
  }

  if (clients.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {showArchived
          ? "No clients yet."
          : "No active clients. Projects without a client are internal."}
      </p>
    );
  }

  function archiveControl(client: Client) {
    if (!canManage || client.archivedAt !== null) {
      return null;
    }

    return (
      <ArchiveDialog
        title={`Archive ${client.name}?`}
        description="Its projects keep the name so past time stays readable, but it disappears from pickers. Archiving cannot be undone — the name becomes available again, so there is no one-click restore."
        triggerAriaLabel={`Archive ${client.name}`}
        disabled={pendingId === client.id}
        onConfirm={() => archive(client)}
      />
    );
  }

  return (
    <>
      <DataCardList className="md:hidden">
        {clients.map((client) => (
          <DataCard
            key={client.id}
            title={client.name}
            muted={client.archivedAt !== null}
            action={archiveControl(client)}
            fields={[
              {
                label: "Status",
                value: client.archivedAt !== null ? "Archived" : "Active",
              },
            ]}
          />
        ))}
      </DataCardList>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              {canManage ? (
                <TableHead className="w-28">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => {
              const isArchived = client.archivedAt !== null;

              return (
                <TableRow
                  key={client.id}
                  className={cn(isArchived && "text-muted-foreground")}
                >
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell>{isArchived ? "Archived" : "Active"}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      {archiveControl(client)}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
