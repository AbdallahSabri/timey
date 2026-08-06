import { describe, expect, it } from "vitest";

import { createTodoSchema } from "@/lib/validations/todo";

describe("createTodoSchema", () => {
  it("accepts a non-empty title", () => {
    const result = createTodoSchema.safeParse({ title: "Write the docs" });

    expect(result.success).toBe(true);
  });

  it("trims whitespace before validating", () => {
    const result = createTodoSchema.safeParse({ title: "  padded  " });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("padded");
    }
  });

  it("rejects an empty title", () => {
    const result = createTodoSchema.safeParse({ title: "   " });

    expect(result.success).toBe(false);
  });

  it("rejects a title over 200 characters", () => {
    const result = createTodoSchema.safeParse({ title: "a".repeat(201) });

    expect(result.success).toBe(false);
  });
});
