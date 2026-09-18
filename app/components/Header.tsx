import { Link } from "@inertiajs/react";
import type { ReactNode } from "react";
import type { SessionUser } from "../user";

export default function Header({ user, children }: { user: SessionUser; children?: ReactNode }) {
  return (
    <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200 bg-white text-sm">
      <Link href="/boards" className="flex items-center gap-1.5 font-bold tracking-tight text-slate-900">
        <img src="/logo.svg" alt="" className="w-6 h-6" />
        jam
      </Link>
      <div className="flex-1 min-w-0 flex items-center gap-2">{children}</div>
      <Link href="/settings" className="text-slate-500 hover:text-slate-900">
        設定
      </Link>
      <span className="flex items-center gap-2 text-slate-700">
        {user.avatarUrl && <img src={user.avatarUrl} alt="" className="w-6 h-6 rounded-full" />}
        <span className="hidden sm:inline">{user.name}</span>
      </span>
      <a href="/auth/logout" className="text-slate-500 hover:text-slate-900">
        ログアウト
      </a>
      {/* 押し間違えないよう、ログアウトとの間を少し空ける */}
      <hashrock-switcher className="ml-2 text-slate-500" />
    </header>
  );
}
