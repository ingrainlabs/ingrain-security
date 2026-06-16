/** Types for the skill-variant runner (`skillVariantTest/run.ts`). */

/** Permission mode a variant window starts claude in: with plan mode, or without. */
export type TRunMode = "plan" | "normal";

/** Parsed CLI args for one variant run. */
export type TParsedArgs = {
  taskId?: string;
  skill: string;
  mode: TRunMode;
};
