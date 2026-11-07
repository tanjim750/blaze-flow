import { notFound } from "next/navigation";

/** Any unknown address under the app renders the branded 404 inside the app shell. */
export default function Missing() {
  notFound();
}
