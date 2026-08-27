"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "./modal";
import { Icon } from "./icons";

export function AdPerformance({ onClose, onReward }: { onClose: () => void; onReward: () => void }) {
  const [remaining, setRemaining] = useState(5000);
  const [paused, setPaused] = useState(false);
  const elapsedRef = useRef(0);
  const claimedRef = useRef(false);

  useEffect(() => {
    let previous = performance.now();
    let visible = !document.hidden;
    const tick = () => {
      const now = performance.now();
      if (visible) elapsedRef.current = Math.min(5000, elapsedRef.current + Math.min(1000, Math.max(0, now - previous)));
      previous = now;
      setRemaining(Math.max(0, 5000 - elapsedRef.current));
    };
    const onVisibility = () => {
      tick();
      visible = !document.hidden;
      setPaused(!visible);
    };
    const interval = window.setInterval(tick, 100);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  const complete = remaining <= 0;
  const claim = () => {
    if (elapsedRef.current < 5000 || claimedRef.current) return;
    claimedRef.current = true;
    onReward();
  };

  return (
    <Modal titleId="ritual-title" onClose={onClose} className="ritual-dialog">
      <span className="disclosure"><span className="small-dot" />これは広告風演出です</span>
      <p className="eyebrow dialog-eyebrow">A MOMENT, SPONSORED BY NOTHING.</p>
      <h2 id="ritual-title">何も、売りません。</h2>
      <p className="dialog-description">この5秒には、何の効能もありません。<br />石と、あなたのための小休止です。</p>
      <div className="ritual-timer" role="timer" aria-label={`あと${Math.ceil(remaining / 1000)}秒`}>
        <svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="88" className="timer-track" /><circle cx="100" cy="100" r="88" className="timer-progress" strokeDasharray={2 * Math.PI * 88} strokeDashoffset={2 * Math.PI * 88 * remaining / 5000} /></svg>
        <span className="timer-number" data-testid="ad-countdown">{complete ? <Icon name="check" width="58" height="58" /> : `0${Math.ceil(remaining / 1000)}`}</span>
        <span className="timer-unit">{complete ? "THANK YOU" : "SECONDS"}</span>
      </div>
      <p className="ritual-status" aria-live="polite">{paused ? "画面に戻るまで、時計もひと休み。" : complete ? "お待たせしました。石が1度だけ動きます。" : "何も起きない時間を、お楽しみください。"}</p>
      <button className="primary-button reward-button" disabled={!complete} onClick={claim}>{complete ? <><Icon name="rotate" />石を1度動かす<span className="button-degree">1°</span></> : <>あと{Math.ceil(remaining / 1000)}秒、ただ眺める</>}</button>
      <p className="dialog-footnote">実際の広告・スポンサー・報酬はありません。<br />途中で閉じた場合、石は動きません。</p>
    </Modal>
  );
}
