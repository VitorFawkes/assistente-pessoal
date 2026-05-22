import { requireUser, AuthError } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    const u = await requireUser();
    if (!u.is_admin) redirect("/");
  } catch (e) {
    if (e instanceof AuthError) redirect("/sem-acesso");
    throw e;
  }

  return (
    <div className="space-y-6">
      <nav className="text-sm flex items-center gap-4 text-[color:var(--muted-strong)]">
        <Link href="/admin/convites" className="hover:text-[color:var(--foreground)] transition">
          Convites
        </Link>
      </nav>
      {children}
    </div>
  );
}
