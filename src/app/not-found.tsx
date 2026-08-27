import Link from "next/link";

export default function NotFound() {
  return <main className="error-page"><p className="eyebrow">NOTHING HERE, EITHER.</p><h1>ここには、石もありません。</h1><p>お探しのページは見つかりませんでした。</p><Link className="primary-button" href="/">石のある場所へ戻る</Link></main>;
}
