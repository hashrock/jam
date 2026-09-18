import BoardEditor from "../../editor/Canvas";
import type { SessionUser } from "../../user";

type Board = { id: string; title: string };

/** ボードの画面。ヘッダーは持たず、キャンバスの上に浮かぶメニューで操作する（FigJam と同じ） */
export default function BoardsShow({ user, board }: { user: SessionUser; board: Board }) {
  return (
    <div className="h-screen relative overflow-hidden">
      <BoardEditor boardId={board.id} title={board.title} user={user} />
    </div>
  );
}
