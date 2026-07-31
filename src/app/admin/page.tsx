import { redirect } from "next/navigation"

// The console has no dashboard worth the name; categories is where work starts.
export default function AdminIndex() {
  redirect("/admin/categories")
}
