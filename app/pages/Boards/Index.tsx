import { Head, Link, router } from "@inertiajs/react";
import { useState } from "react";
import Header from "../../components/Header";
import type { SessionUser } from "../../user";

type Board = { id: string; title: string; updatedAt: string };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ja-JP", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function BoardsIndex({ user, boards }: { user: SessionUser; boards: Board[] }) {
  const [title, setTitle] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    router.post("/boards", { title });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Head title="ボード" />
      <Header user={user} />
      <main className="mx-auto max-w-3xl px-6 py-8">
        <form onSubmit={create} className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="新しいボードの名前"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">作成</button>
        </form>

        {boards.length === 0 ? (
          <p className="mt-12 text-center text-sm text-slate-500">
            ボードはまだありません。ここで作るか、エージェントに <code className="rounded bg-slate-200 px-1">create_board</code> で作ってもらえます。
          </p>
        ) : (
          <ul className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {boards.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                <Link href={`/boards/${b.id}`} className="flex-1 min-w-0">
                  <div className="truncate font-medium">{b.title}</div>
                  <div className="text-xs text-slate-500">{fmt(b.updatedAt)}</div>
                </Link>
                {confirming === b.id ? (
                  <span className="flex gap-2 text-xs">
                    <button
                      onClick={() => router.delete(`/boards/${b.id}`, { preserveScroll: true })}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-500"
                    >
                      削除する
                    </button>
                    <button onClick={() => setConfirming(null)} className="px-2 py-1 text-slate-500 hover:text-slate-900">
                      やめる
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setConfirming(b.id)} className="text-xs text-slate-400 hover:text-red-600">
                    削除
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
