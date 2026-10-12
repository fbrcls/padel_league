import { z } from "zod";
export const resultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("played"),
    games_a: z.number().int().min(0).max(999),
    games_b: z.number().int().min(0).max(999),
  }),
  z.object({ kind: z.literal("forfeit"), forfeiting_entry: z.string().min(1) }),
]);
export const matchSchema = z.object({
  entry_a: z.string(),
  entry_b: z.string(),
  played_at: z.iso.datetime({ offset: true }),
  result: resultSchema.optional(),
  key: z.uuid(),
});
export const versionSchema = z.object({ version: z.number().int().positive() });
export const submissionSchema = z.object({
  version: z.number().int().positive(),
  key: z.uuid(),
  result: resultSchema,
});
export const disputeSchema = z.object({
  version: z.number().int().positive(),
  result: resultSchema,
  reason: z.string().trim().min(1).max(1000),
});
export const resolutionSchema = z.object({
  version: z.number().int().positive(),
  result: resultSchema,
  reason: z.string().trim().min(1).max(1000),
});
export type Result = z.infer<typeof resultSchema>;
export type Match = {
  id: string;
  box_id: string;
  entry_a: string;
  entry_b: string;
  played_at: string;
  status: string;
  version: number;
  submitted_entry: string | null;
  kind: "played" | "forfeit" | null;
  games_a: number | null;
  games_b: number | null;
  forfeiting_entry: string | null;
  deadline: string | null;
  proposal: any;
  [key: string]: any;
};
export type Entry = {
  id: string;
  pair_id: string;
  box_id: string;
  player1: string;
  player2: string;
  name_a: string;
  name_b: string;
};
