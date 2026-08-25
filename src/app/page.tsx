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
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Timey</CardTitle>
          <CardDescription>
            Timey records how long people work, against what.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href="/sign-up">Create an account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
