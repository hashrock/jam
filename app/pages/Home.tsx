import { Head } from "@inertiajs/react";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-6">
      <Head title="jam" />
      <main className="max-w-xl">
        <h1 className="text-4xl font-bold tracking-tight">jam</h1>
        <p className="mt-4 text-slate-600 leading-relaxed">
          Claude Code や Codex と一緒に使うホワイトボード。コードの要約、issue のリンク集、TODO と依存関係、設計図をエージェントに並べてもらい、同じ画面を手で直せる。
        </p>
        <a
          href="/auth/google"
          className="inline-block mt-8 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Google でログイン
        </a>
      </main>
    </div>
  );
}
