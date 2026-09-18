import { Head } from "@inertiajs/react";
import { useState } from "react";
import Header from "../../components/Header";
import BoardEditor from "../../editor/Canvas";
import type { SessionUser } from "../../user";

type Board = { id: string; title: string };

function TitleInput({ board }: { board: Board }) {
  const [title, setTitle] = useState(board.title);
  const [saved, setSaved] = useState(board.title);
  const save = async () => {
    const next = title.trim();
    if (!next || next === saved) return setTitle(saved);
    const res = await fetch(`/api/boards/${board.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
    if (res.ok) setSaved(next);
    else setTitle(saved);
  };
  return (
    <>
      <Head title={saved} />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="min-w-0 flex-1 max-w-md rounded px-2 py-1 font-medium text-slate-900 outline-none hover:bg-slate-100 focus:bg-slate-100"
        aria-label="ボード名"
      />
    </>
  );
}

export default function BoardsShow({ user, board }: { user: SessionUser; board: Board }) {
  return (
    <div className="h-screen flex flex-col">
      <Header user={user}>
        <span className="text-slate-300">/</span>
        <TitleInput board={board} />
      </Header>
      <div className="relative flex-1">
        <BoardEditor boardId={board.id} />
      </div>
    </div>
  );
}
