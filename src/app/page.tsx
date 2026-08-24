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
        <CardContent>
          <p className="text-muted-foreground text-sm">
            See README.md for the fork checklist and how to wire up your first
            Supabase table.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
