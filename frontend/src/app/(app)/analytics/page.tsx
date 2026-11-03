import { redirect } from "next/navigation";

/** Analytics is the dashboard at "/"; this alias keeps /analytics links working. */
export default function Analytics() {
  redirect("/");
}
