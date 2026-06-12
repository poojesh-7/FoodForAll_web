import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function Home() {
  const cookieStore = await cookies();
  const isAuthenticated = Boolean(
    cookieStore.get("accessToken")?.value || cookieStore.get("refreshToken")?.value
  );

  redirect(isAuthenticated ? "/dashboard" : "/login");
}
