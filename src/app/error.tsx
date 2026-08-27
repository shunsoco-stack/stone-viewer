"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="error-page"><p className="eyebrow">A LITTLE PAUSE.</p><h1>石も、ひと休み中です。</h1><p>うまく表示できませんでした。もう一度お試しください。</p><button className="primary-button" onClick={reset}>もう一度、眺める</button></main>;
}
