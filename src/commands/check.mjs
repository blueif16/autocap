import { runShots } from "./take.mjs";

export const usage = "check [prefix …]         run shots at full speed without recording; every target must resolve";
export const config = "required";
export const run = (ctx) => runShots(ctx, true);
