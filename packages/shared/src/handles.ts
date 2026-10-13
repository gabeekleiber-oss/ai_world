import { z } from "zod";

/** Per-agent handles (DESIGN.md section 7): thing-3, other-1, place-2. Never shared between agents. */
export const HandleSchema = z.string().regex(/^(thing|other|place)-\d+$/, "not a handle");
export type Handle = z.infer<typeof HandleSchema>;

export const HEADINGS = ["ahead", "ahead-left", "left", "behind-left", "behind", "behind-right", "right", "ahead-right"] as const;
export const HeadingSchema = z.enum(HEADINGS);
export type Heading = z.infer<typeof HeadingSchema>;
