"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStoneSession } from "@/hooks/use-stone-session";
import { trackStoneEvent } from "@/lib/analytics";
import StoneScene from "./stone-scene";
import { AdPerformance } from "./ad-performance";
import { Icon } from "./icons";
import { Modal } from "./modal";

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60).toString().padStart(2, "0");
  const remainder = (value % 60).toString().padStart(2, "0");
  return hours ? `${hours.toString().padStart(2, "0")}:${minutes}:${remainder}` : `${minutes}:${remainder}`;
}

function useViewingAnalytics(seconds: number) {
  const current = useRef(0);
  const reported = useRef(0);
  useEffect(() => {
    current.current = seconds;
    if (seconds - reported.current >= 60) {
      trackStoneEvent("stone_viewing_time", { seconds: seconds - reported.current, total_seconds: seconds });
      reported.current = seconds;
    }
  }, [seconds]);
  useEffect(() => {
    const flush = () => {
      const delta = current.current - reported.current;
      if (delta <= 0) return;
      trackStoneEvent("stone_viewing_time", { seconds: delta, total_seconds: current.current });
      reported.current = current.current;
    };
    const visibility = () => { if (document.hidden) flush(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", flush);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", flush); };
  }, []);
}

export function StoneViewer() {
  const session = useStoneSession();
  const { ready, rotations, stone, theme, mode, quality, todaySeconds, sessionSeconds, storageAvailable } = session;
  const [zen, setZen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [adOpen, setAdOpen] = useState(false);
  const [milestone, setMilestone] = useState<number | null>(null);
  const [about, setAbout] = useState(false);
  const [shareFallback, setShareFallback] = useState<string | null>(null);
  const [renderer, setRenderer] = useState<"webgl" | "svg">("svg");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zenExit = useRef<HTMLButtonElement>(null);
  const zenEntry = useRef<HTMLButtonElement>(null);
  const hasEnteredZen = useRef(false);
  const shareInput = useRef<HTMLTextAreaElement>(null);

  useViewingAnalytics(sessionSeconds);

  const notify = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
    const color = theme === "dark" ? "#151815" : "#f6f5f1";
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", color));
  }, [theme]);

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    if (zen) {
      hasEnteredZen.current = true;
      zenExit.current?.focus();
    } else if (hasEnteredZen.current) {
      zenEntry.current?.focus();
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && zen) setZen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zen]);

  const rotate = () => {
    if (!ready) return;
    const next = session.rotateOne();
    trackStoneEvent("stone_rotate", { degrees: next, mode });
    if (next > 0 && next % 360 === 0) setMilestone(next);
  };

  const requestRotation = () => {
    if (mode === "ritual") setAdOpen(true);
    else rotate();
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else notify("このブラウザでは全画面を使えません。禅モードをお試しください。");
    } catch {
      notify("全画面に切り替えられませんでした。禅モードもご利用いただけます。");
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/`;
    const text = `「${stone.name}」を、${rotations.toLocaleString("ja-JP")}度だけ動かしました。\n何もしないを、ひとつ。 #石を見る`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "石を見る", text, url });
        trackStoneEvent("stone_share", { method: "native", degrees: rotations });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard not available");
      await navigator.clipboard.writeText(`${text}\n${url}`);
      trackStoneEvent("stone_share", { method: "clipboard", degrees: rotations });
      notify("この静けさを、クリップボードにコピーしました。");
    } catch {
      setShareFallback(`${text}\n${url}`);
    }
  };

  const rename = () => {
    session.renameStone();
    notify("名前を変えました。石そのものは、同じです。");
  };

  const lap = Math.floor(rotations / 360);
  const toGo = 360 - rotations % 360;

  return (
    <div className="viewer" data-theme={theme} data-zen={zen} data-ready={ready}>
      <a className="skip-link" href="#viewing-controls">鑑賞の操作へ</a>
      <header className="gallery-header gallery-ui">
        <Link href="/" className="brand" aria-label="石を見る ホーム"><Icon name="stone" width="27" height="27" /><span>石を見る</span><span className="brand-divider" /><span className="brand-caption">THE ART OF DOING NOTHING</span></Link>
        <nav className="header-controls" aria-label="展示室の設定">
          <button ref={zenEntry} className="zen-button" onClick={() => setZen(true)} aria-label="禅モードに入る"><Icon name="zen" /><span>禅モード</span></button>
          <span className="control-divider" />
          <button className="icon-button" aria-label={theme === "light" ? "夜の展示室に切り替える" : "昼の展示室に切り替える"} title={theme === "light" ? "ダークモード" : "ライトモード"} onClick={() => session.setTheme(theme === "light" ? "dark" : "light")}><Icon name={theme === "light" ? "moon" : "sun"} /></button>
          <button className="icon-button fullscreen-button" aria-label={fullscreen ? "全画面を終了" : "全画面で鑑賞する"} title="全画面" onClick={toggleFullscreen}><Icon name={fullscreen ? "shrink" : "expand"} /></button>
        </nav>
      </header>

      <main className="gallery-main">
        <section className="intro gallery-ui" aria-labelledby="gallery-title">
          <p className="exhibition-status"><span className="small-dot" />いつでも、静かに開館中</p>
          <h1 id="gallery-title">何もしないを、ひとつ。</h1>
          <p className="intro-description">ただ、石を眺める。それだけの場所です。</p>
        </section>

        <section className="exhibit" aria-label="石の展示">
          <aside className="exhibit-label gallery-ui" aria-label="作品情報">
            <p className="eyebrow exhibit-number">PERMANENT COLLECTION</p>
            <span className="catalogue-rule" />
            <p className="catalogue-title">そこに、ある。</p>
            <p className="catalogue-description">何かにならなくても、<br />ここにいていい。</p>
            <dl className="catalogue-details"><div><dt>素材</dt><dd>たぶん、石。</dd></div><div><dt>作者</dt><dd>時間と、数式。</dd></div><div><dt>用途</dt><dd>とくになし。</dd></div></dl>
          </aside>

          <div className="stone-stage">
            <div className="stage-halo" aria-hidden="true" />
            <div className="orbital-ring gallery-ui" aria-hidden="true"><span className="orbit-dot" /><span className="orbit-label">ONE STONE. INFINITE NOTHING.</span></div>
            <div className="stone-viewport"><StoneScene angle={rotations} seed={stone.seed} theme={theme} quality={quality} onRendererChange={setRenderer} /></div>
            <div className="stage-corner corner-tl gallery-ui" aria-hidden="true" /><div className="stage-corner corner-br gallery-ui" aria-hidden="true" />
            <p className="no-drag gallery-ui"><span />ドラッグしても、何も起きません。</p>
          </div>

          <aside className="angle-aside gallery-ui" aria-label="現在の向き">
            <p className="eyebrow">SLOWLY, SURELY.</p>
            <div className="angle-gauge" aria-hidden="true"><i /><i /><i /><i /><i className="gauge-active" /><i /><i /><i /><i /></div>
            <p className="aside-degrees">{rotations % 360}<span>°</span></p>
            <p className="angle-caption">いまの向き</p>
          </aside>
        </section>

        <section className="stone-caption gallery-ui" aria-label="石の名前">
          <p className="specimen-id">NO. {stone.id} <span>—</span> ONE OF A KIND</p>
          <div className="name-row"><h2 data-testid="stone-name">{stone.name}</h2><button className="icon-button rename-button" onClick={rename} disabled={!ready} aria-label="石の名前をつけなおす" title="名前をつけなおす"><Icon name="shuffle" width="15" height="15" /></button></div>
          <p className="stone-description">{stone.description}</p>
        </section>

        <section id="viewing-controls" className="viewing-controls gallery-ui" aria-label="石を動かす">
          <button className="primary-button rotate-button" onClick={requestRotation} disabled={!ready} data-testid="rotate-button"><Icon name={mode === "ritual" ? "clock" : "rotate"} />{mode === "ritual" ? "5秒の広告風演出を見る" : "石を1度動かす"}<span className="button-degree">1°</span></button>
          <p className="button-caption">{mode === "ritual" ? "見終えたら、1度。急ぐ理由もありません。" : "たった1度。それだけ、世界が変わります。"}</p>
          <div className="mode-switch" role="group" aria-label="回転モード">
            <button aria-pressed={mode === "free"} className={mode === "free" ? "selected" : ""} onClick={() => session.setMode("free")}>そのまま、1度</button>
            <button aria-pressed={mode === "ritual"} className={mode === "ritual" ? "selected" : ""} onClick={() => session.setMode("ritual")}><span className="mode-indicator" />広告風モード<span className="mode-seconds">5s</span></button>
          </div>
          {mode === "ritual" && <p className="mode-disclaimer">実際の広告は流れません。</p>}
        </section>

        <section className="viewing-record gallery-ui" aria-label="鑑賞の記録">
          <div className="record-cell"><p className="record-label"><Icon name="rotate" width="14" height="14" />累計の回転</p><p className="record-value"><output data-testid="total-degrees" aria-label="累計回転角度">{rotations.toLocaleString("ja-JP")}</output><span className="degree-unit">°</span></p><p className="record-footnote">{lap > 0 ? `${lap.toLocaleString("ja-JP")}周。次の一周まで、あと${toGo}度。` : `一周まで、あと${toGo}度。`}</p><div className="lap-progress" role="progressbar" aria-label="一周への歩み" aria-valuemin={0} aria-valuemax={360} aria-valuenow={rotations % 360} aria-valuetext={`${lap}周と${rotations % 360}度`}><span style={{ width: `${rotations % 360 / 360 * 100}%` }} /></div></div>
          <div className="record-cell"><p className="record-label"><Icon name="clock" width="14" height="14" />このひととき</p><p className="record-value"><output data-testid="session-time" aria-label="今回の鑑賞時間">{formatTime(sessionSeconds)}</output></p><p className="record-footnote">石と過ごした、何でもない時間。</p></div>
          <div className="record-cell"><p className="record-label"><Icon name="sun" width="15" height="15" />本日の鑑賞時間</p><p className="record-value"><output data-testid="today-time" aria-label="本日の鑑賞時間">{formatTime(todaySeconds)}</output></p><p className="record-footnote">{storageAvailable ? "この端末に、そっと記録。" : "保存できないため、今回だけの記録です。"}</p></div>
        </section>

        <div className="closing-note gallery-ui"><span className="small-star" aria-hidden="true">✳</span><p>生産性のない時間も、いい時間。</p></div>
      </main>

      <footer className="gallery-footer gallery-ui">
        <div className="footer-left"><span className="footer-brand">石を見る</span><span className="footer-dot">·</span><button className="text-button" onClick={() => setAbout(true)}>この場所について</button><a className="text-button" href="/privacy">プライバシーポリシー</a></div>
        <div className="footer-right"><button className="text-button quality-button" aria-pressed={quality === "lite"} onClick={() => { session.setQuality(quality === "lite" ? "auto" : "lite"); notify(quality === "lite" ? "お使いの端末に合わせて表示します。" : "軽量なSVG表示に切り替えました。"); }} title="WebGLを使わない軽量なSVG表示に切り替える"><Icon name="leaf" width="14" height="14" /><span>{quality === "lite" ? "軽量表示中" : renderer === "svg" && ready ? "SVG表示" : "軽量表示"}</span></button><button className="text-button share-button" onClick={share} aria-label="この静けさを共有"><Icon name="share" width="15" height="15" />この静けさを共有</button></div>
      </footer>

      {zen && <><button ref={zenExit} className="zen-exit" onClick={() => setZen(false)}><Icon name="zen" /><span>禅モードを終了</span><kbd>esc</kbd></button><div className="zen-note"><p>ただ、ここに。</p><span>{formatTime(sessionSeconds)}</span></div></>}

      <div className={`toast ${toast ? "toast-visible" : ""}`} role="status" aria-live="polite">{toast && <><Icon name="check" width="16" height="16" />{toast}</>}</div>

      {adOpen && <AdPerformance onClose={() => setAdOpen(false)} onReward={() => { setAdOpen(false); rotate(); }} />}

      {milestone !== null && <Modal titleId="milestone-title" className="milestone-dialog" onClose={() => setMilestone(null)}>
        <p className="eyebrow">A SMALL, COMPLETE REVOLUTION.</p>
        <div className="milestone-emblem" aria-hidden="true"><svg viewBox="0 0 240 240"><circle cx="120" cy="120" r="107" /><circle cx="120" cy="120" r="95" /><path d="M120 7v12m0 202v12M7 120h12m202 0h12" /></svg><span>{milestone.toLocaleString("ja-JP")}<sup>°</sup></span><small>{milestone / 360 === 1 ? "THE FIRST CIRCLE" : `${milestone / 360} COMPLETE CIRCLES`}</small></div>
        <span className="milestone-label">{milestone / 360}周記念</span>
        <h2 id="milestone-title">一周して、<br />同じ石。</h2>
        <p className="dialog-description">けれど、ここまで眺めたあなたは、<br />最初のあなたとは少し違う。たぶん。</p>
        <p className="milestone-thanks">{milestone.toLocaleString("ja-JP")}回の小さな決断に、ささやかな拍手を。</p>
        <button className="primary-button" onClick={() => setMilestone(null)}>もう少し、眺める<Icon name="arrow" /></button>
        <button className="text-button milestone-share" onClick={share}><Icon name="share" width="15" height="15" />この一周を共有する</button>
      </Modal>}

      {about && <Modal titleId="about-title" className="about-dialog" onClose={() => setAbout(false)}>
        <Icon name="stone" width="36" height="36" /><p className="eyebrow">ABOUT THIS LITTLE PLACE</p><h2 id="about-title">役に立たないを、<br />丁寧につくりました。</h2>
        <p>石を眺める。それ以上の目的はありません。<br />ボタンを押すと正確に1度、360回で一周。<br />ドラッグしても、石は振り向きません。</p>
        <div className="about-detail"><h3>すべて、ここで生まれた石です。</h3><p>形も模様も、数式からつくったオリジナル。外部の画像・3Dモデル・有料素材は使っていません。石の名前を変えても、石と記録はそのままです。</p><h3>記録は、この端末に。</h3><p>回転角度と日別の鑑賞時間、表示設定をlocalStorageに保存します。画面が見えている時間だけを数え、日付はお使いの端末の現地時間で区切ります。非表示中・長いスリープ中は増えません。ブラウザのデータを消すと記録も消えます。</p><h3>広告ではなく、広告「風」。</h3><p>5秒の演出にスポンサーも、実際の広告もありません。画面を離れると一時停止し、見終えたあとに一度だけ回せます。</p><h3>静けさを、どの端末にも。</h3><p>WebGLを利用できない端末や低スペック端末では、軽量なSVGの石に切り替わります。SVGでは1度の動きを平面回転で表現します。対応ブラウザでホーム画面に追加すると、アプリとして使えます。</p><h3>アクセス計測について</h3><p>Vercel Analyticsを使用します。鑑賞記録や石の名前は送信しません。回転・鑑賞時間・共有の匿名イベントは、対応プランで計測設定を有効にした場合に限ります。Do Not Trackを尊重します。</p></div>
        <button className="primary-button" onClick={() => setAbout(false)}>石のある場所へ<Icon name="arrow" /></button>
      </Modal>}

      {shareFallback && <Modal titleId="share-title" className="share-dialog" onClose={() => setShareFallback(null)}><p className="eyebrow">A LITTLE QUIET, TO GO.</p><h2 id="share-title">静けさを、おすそわけ。</h2><p className="dialog-description">自動コピーを利用できませんでした。<br />下の文章を選択してコピーしてください。</p><textarea ref={shareInput} aria-label="共有する文章とURL" value={shareFallback} readOnly rows={5} onFocus={(event) => event.currentTarget.select()} onCopy={() => trackStoneEvent("stone_share", { method: "manual", degrees: rotations })} /><button className="primary-button" onClick={() => { shareInput.current?.focus(); shareInput.current?.select(); }}>文章を選択する</button></Modal>}
    </div>
  );
}
