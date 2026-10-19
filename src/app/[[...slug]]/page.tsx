import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { staff } from "@/server/auth";
import { Workspace } from "@/components/Workspace";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const route = slug[0] || "dashboard";
  if (
    ![
      "dashboard",
      "login",
      "account",
      "studio",
      "content",
      "screens",
      "groups",
      "schedule",
      "live",
      "pair",
      "settings",
      "display",
    ].includes(route)
  )
    notFound();
  if (!["login", "account"].includes(route)) {
    let authenticated = false;
    try {
      await staff(
        new Request("http://localhost", { headers: await headers() }),
      );
      authenticated = true;
    } catch {}
    if (!authenticated) redirect("/login");
  }
  return <Workspace route={route} detail={slug[1]} />;
}
