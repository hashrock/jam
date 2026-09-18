import { Head, router } from "@inertiajs/react";
import { useState } from "react";
import Header from "../components/Header";
import type { SessionUser } from "../user";

type Token = { id: string; name: string; createdAt: string };

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-2">
      <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 pr-16 text-xs leading-relaxed text-slate-100">{children}</pre>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(children).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute right-2 top-2 rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-100 hover:bg-slate-600"
      >
        {copied ? "コピー済み" : "コピー"}
      </button>
    </div>
  );
}

export default function Settings({ user, tokens, mcpUrl }: { user: SessionUser; tokens: Token[]; mcpUrl: string }) {
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<string | null>(null);
  const load = () => router.reload({ only: ["tokens"] });

  const issue = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || "default" }),
    });
    if (!res.ok) return;
    setIssued(((await res.json()) as { token: string }).token);
    setName("");
    void load();
  };

  const revoke = async (id: string) => {
    await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    void load();
  };

  const token = issued ?? "<API トークン>";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Head title="設定" />
      <Header user={user} />
      <main className="mx-auto max-w-3xl px-6 py-8 space-y-10">
        <section>
          <h2 className="text-lg font-bold">エージェントから使う（リモート MCP）</h2>
          <p className="mt-2 text-sm text-slate-600">
            API トークンを発行して、Claude Code や Codex に MCP サーバーとして登録します。エージェントの変更は開いているボードにすぐ反映されます。
          </p>

          <form onSubmit={issue} className="mt-4 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="トークンの名前（例: laptop claude code）"
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
            <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">発行</button>
          </form>

          {issued && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
              <div className="font-medium">トークンを発行しました。この画面を離れると二度と表示されません。</div>
              <Code>{issued}</Code>
            </div>
          )}

          <h3 className="mt-6 text-sm font-bold">Claude Code</h3>
          <Code>{`claude mcp add --transport http jam ${mcpUrl} --header "Authorization: Bearer ${token}"`}</Code>

          <h3 className="mt-6 text-sm font-bold">Codex（~/.codex/config.toml）</h3>
          <Code>{`[mcp_servers.jam]
url = "${mcpUrl}"
bearer_token_env_var = "JAM_TOKEN"`}</Code>
          <p className="mt-2 text-xs text-slate-500">
            環境変数 <code className="rounded bg-slate-200 px-1">JAM_TOKEN</code> にトークンを入れておきます。
          </p>

          <h3 className="mt-6 text-sm font-bold">発行済みのトークン</h3>
          {tokens.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">まだありません。</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white text-sm">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="text-xs text-slate-500">{new Date(t.createdAt).toLocaleDateString("ja-JP")}</span>
                  <button onClick={() => void revoke(t.id)} className="text-xs text-slate-400 hover:text-red-600">
                    無効にする
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold">ブラウザから使う（WebMCP）</h2>
          <p className="mt-2 text-sm text-slate-600">
            ボードを開いたページは、そのボードの <code className="rounded bg-slate-200 px-1">get_board</code> /{" "}
            <code className="rounded bg-slate-200 px-1">apply</code> を WebMCP で公開します。Chrome で{" "}
            <code className="rounded bg-slate-200 px-1">chrome://flags/#enable-webmcp-testing</code> を有効にし、Chrome DevTools MCP を
            WebMCP 付きで登録すると、エージェントがページ経由で操作できます。
          </p>
          <Code>{`claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest --categoryExperimentalWebmcp=true --autoConnect`}</Code>
        </section>
      </main>
    </div>
  );
}
