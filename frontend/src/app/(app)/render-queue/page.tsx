import { redirect } from "next/navigation";

// This tab was removed from the app; old links and bookmarks land on the dashboard.
export default function Removed(): never {
  redirect("/");
}
