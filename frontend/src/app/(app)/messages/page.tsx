import { redirect } from "next/navigation";

/** Kept so old notification and bookmark links still work. */
export default function MessagesRedirect() {
  redirect("/chat");
}
