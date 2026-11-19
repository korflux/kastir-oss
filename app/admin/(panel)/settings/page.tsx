import { redirect } from "next/navigation";

/** Setup raiz → aba General (default do Figma). */
export default function SetupIndexPage() {
  redirect("/admin/settings/general");
}
