"use client";

import { ScheduleForm } from "@/components/project-members/schedule-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The project page's entry point to §3.6.3's schedule: one member's hours on
 * *this* project.
 *
 * A dialog around `ScheduleForm` and nothing else — every rule about what a
 * schedule is, how hours become seconds, and what happens when RLS filters the
 * update lives in that form, so the Team page's inline editor cannot answer any
 * of it differently.
 */
export function MemberScheduleDialog({
  projectId,
  userId,
  memberName,
  projectName,
  expectedDailySeconds,
  workingDays,
  weekStartsOn,
  open,
  onOpenChange,
}: {
  projectId: string;
  userId: string;
  memberName: string;
  projectName: string;
  expectedDailySeconds: number;
  workingDays: readonly number[];
  weekStartsOn: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Expected hours for {memberName}</DialogTitle>
          <DialogDescription>
            On{" "}
            <span className="text-foreground font-medium">{projectName}</span>.
            Hours are set per project, so the same person can work different
            days here and elsewhere — what a report expects of them is the sum
            of every assignment.
          </DialogDescription>
        </DialogHeader>

        <ScheduleForm
          projectId={projectId}
          userId={userId}
          memberName={memberName}
          expectedDailySeconds={expectedDailySeconds}
          workingDays={workingDays}
          weekStartsOn={weekStartsOn}
          onSaved={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
