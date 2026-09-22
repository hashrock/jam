import { BoardViewer } from "../../editor/Canvas";

type Board = { publicId: string; title: string };

/** 共有リンクの画面。ログインしていなくても見られる閲覧専用のボード */
export default function BoardsPublic({ board }: { board: Board }) {
  return (
    <div className="h-screen relative overflow-hidden">
      <BoardViewer publicId={board.publicId} title={board.title} />
    </div>
  );
}
