import { submitCorrectionSchema } from "@/lib/validations/corrections";

import type { z } from "zod";

/**
 * The three members of `submitCorrectionSchema`, read back off the union.
 *
 * **This defines no validation.** `lib/validations/corrections.ts` owns every
 * rule here; `z.discriminatedUnion` keeps its members on `.options`, and this is
 * that tuple destructured so a form can resolve against the one branch it
 * actually edits. A second, hand-written "form schema" would be a copy of rules
 * that already exist — and the copy is what drifts.
 *
 * The union itself cannot be handed to `useForm` directly: `Path<A | B | C>`
 * collapses to the fields all three share (`kind`, `reason`), so `register`
 * would refuse `proposedStartedAt` and every per-kind field with it.
 *
 * The order below is the union's declared order, and it is checked at compile
 * time rather than trusted: each form's `defaultValues` pins `kind` to a
 * literal, so a schema reordered upstream stops typechecking here instead of
 * quietly validating an `amend` against the `create` branch.
 */
export const [
  createCorrectionSchema,
  amendCorrectionSchema,
  deleteCorrectionSchema,
] = submitCorrectionSchema.options;

export type CreateCorrectionInput = z.input<typeof createCorrectionSchema>;
export type CreateCorrectionValues = z.output<typeof createCorrectionSchema>;

export type AmendCorrectionInput = z.input<typeof amendCorrectionSchema>;
export type AmendCorrectionValues = z.output<typeof amendCorrectionSchema>;

export type DeleteCorrectionInput = z.input<typeof deleteCorrectionSchema>;
export type DeleteCorrectionValues = z.output<typeof deleteCorrectionSchema>;
