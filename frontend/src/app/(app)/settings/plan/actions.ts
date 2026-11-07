"use server";

import { revalidatePath } from "next/cache";
import { changeSubscriptionPlan } from "@/lib/api";

export type PlanState = { error: string | null; message: string | null };

export async function changePlanAction(_previous: PlanState, form: FormData): Promise<PlanState> {
  const plan = String(form.get("plan") ?? "");
  const label = String(form.get("label") ?? "");
  if (plan !== "SOLO" && plan !== "PRO") return { error: "Pick a plan.", message: null };
  const result = await changeSubscriptionPlan(plan);
  if (!result.ok) return { error: result.error.detail, message: null };
  revalidatePath("/", "layout");
  return { error: null, message: `You're on ${label || (plan === "SOLO" ? "Solo" : "Starter")} now.` };
}
