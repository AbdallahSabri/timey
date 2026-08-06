import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Next.js Template</CardTitle>
          <CardDescription>
            Next.js 15 + Tailwind + shadcn/ui + Supabase, ready to fork.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            The <code>/todos</code> route is a demo CRUD flow wired up to
            Supabase — remove it once you&apos;ve confirmed your project
            connects, or keep it as a reference. See README.md for the fork
            checklist.
          </p>
          <Button asChild className="w-fit">
            <Link href="/todos">View demo CRUD</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
