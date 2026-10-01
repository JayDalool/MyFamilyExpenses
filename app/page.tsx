import { redirect } from "next/navigation";
import { getCurrentHousehold, getCurrentUser } from "@/lib/auth/session";

export default async function HomePage() {
  const user = await getCurrentUser();

  if (user) {
    const auth = await getCurrentHousehold();
    redirect(auth ? "/dashboard" : "/no-household");
  }

  redirect("/auth/login");
}
