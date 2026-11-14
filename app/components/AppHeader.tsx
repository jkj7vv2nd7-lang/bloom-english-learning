import Link from "next/link";

export default function AppHeader({ active }: { active: "story" | "wordbook" }) {
  return (
    <header className="topbar">
      <Link className="brand" href="/" aria-label="Bloom English ホーム">
        <span className="brand-mark" aria-hidden="true">✦</span>
        <span>Bloom English</span>
      </Link>
      <nav className="main-nav" aria-label="メインメニュー">
        <Link className={active === "story" ? "active" : ""} href="/">ストーリー</Link>
        <Link className={active === "wordbook" ? "active" : ""} href="/wordbook">単語帳</Link>
      </nav>
      <span className="header-note"><span className="status-dot" /> 毎日5分、英語が育つ。</span>
    </header>
  );
}
