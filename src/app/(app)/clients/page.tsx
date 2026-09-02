import { redirect } from "next/navigation";

import { ClientList } from "@/components/clients/client-list";
import { CreateClientForm } from "@/components/clients/create-client-form";
import { ArchivedToggle } from "@/components/structure/archived-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listClients } from "@/lib/actions/clients";
import { getCurrentMember } from "@/lib/actions/companies";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Clients · Timey",
};

/**
 * §4.2.2: admin-only route. An employee is redirected to the dashboard — the
 * create form and the archive controls are the whole page, and both are
 * admin-gated in Postgres (`createClient`, `archiveClient`), so what was left
 * for an employee was a read-only list with nothing to do on it.
 *
 * **The redirect is not what protects the client list.**
 * `clients_select_own_company` (§4.2) stays company-wide, because
 * `listProjects()` embeds it to label an employee's own projects with their
 * client. Narrowing the policy would blank that label. This hides a route, and
 * nothing more.
 *
 * The check is repeated in middleware, which does not run on every rendering
 * path — so the page carries its own.
 *
 * The archived view is a URL, not component state: the list is server-rendered,
 * so switching it is a navigation that survives a reload.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === "1";

  const [memberResult, clientsResult] = await Promise.all([
    getCurrentMember(),
    listClients({ includeArchived: showArchived }),
  ]);

  const currentMember = memberResult.ok ? memberResult.data : null;
  const isAdmin =
    currentMember?.role === "admin" && currentMember.status === "active";

  if (!isAdmin) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <p className="text-muted-foreground text-sm">
          Who the work is for. A project without a client is internal.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {showArchived ? "All clients" : "Active clients"}
          </CardTitle>
          <CardDescription>
            Archiving keeps a client readable on past work and takes it out of
            the pickers. It cannot be undone.
          </CardDescription>
          <ArchivedToggle
            showArchived={showArchived}
            basePath="/clients"
            subject="clients"
          />
        </CardHeader>
        <CardContent>
          {clientsResult.ok ? (
            <ClientList
              clients={clientsResult.data}
              canManage={isAdmin}
              showArchived={showArchived}
            />
          ) : (
            <p className="text-destructive text-sm">{clientsResult.error}</p>
          )}
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a client</CardTitle>
            <CardDescription>
              Names are unique among active clients — archiving one frees its
              name again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateClientForm />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
