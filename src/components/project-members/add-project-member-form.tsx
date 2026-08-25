"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { nativeSelectClassName } from "@/components/structure/select-class";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import type { CompanyMember } from "@/lib/actions/companies";
import { addProjectMember } from "@/lib/actions/project-members";

/**
 * The candidate list is everyone in the company who is not already on this
 * project — `listMembers()` minus `listProjectMembers()`, diffed by the page.
 * No server action exists for that anti-join and none is asked for: a company's
 * headcount is not a scale problem, and a second query shape would be a second
 * thing to keep correct.
 *
 * Deactivated members stay in the list, marked. §2.3 keeps them for their
 * history and nothing in the schema refuses their assignment, so filtering them
 * out here would be this component inventing a rule.
 *
 * No `react-hook-form` here — one `<select>` of opaque ids has no schema in
 * `validations/structure.ts` to resolve against, and `addProjectMember`
 * validates the uuid itself.
 */
export function AddProjectMemberForm({
  projectId,
  candidates,
}: {
  projectId: string;
  candidates: CompanyMember[];
}) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [pending, setPending] = useState(false);

  if (candidates.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Everyone in your company is already assigned to this project.
      </p>
    );
  }

  async function add() {
    const candidate = candidates.find((member) => member.id === userId);
    if (!candidate) {
      return;
    }

    setPending(true);
    const result = await addProjectMember(projectId, candidate.id);
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`${candidate.fullName} can now log time to this project.`);
    setUserId("");
    router.refresh();
  }

  return (
    <FieldGroup>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Field className="flex-1">
          <FieldLabel htmlFor="project-member">Add someone</FieldLabel>
          <select
            id="project-member"
            className={nativeSelectClassName}
            value={userId}
            disabled={pending}
            onChange={(event) => setUserId(event.target.value)}
          >
            <option value="">Select a person…</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.fullName}
                {candidate.status === "active" ? "" : " (inactive)"}
              </option>
            ))}
          </select>
          <FieldDescription>
            Assignment is what allows logging time — admins included. Being an
            admin shows every project; it does not put you on one.
          </FieldDescription>
        </Field>

        <Button
          type="button"
          className="sm:mt-6"
          disabled={pending || userId === ""}
          onClick={() => void add()}
        >
          {pending ? "Adding…" : "Add to project"}
        </Button>
      </div>
    </FieldGroup>
  );
}
