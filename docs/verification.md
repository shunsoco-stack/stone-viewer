# 公開時の検証記録

確認日：2026年8月27日（日本時間）

- 公開URL：[石を見る](https://stone-viewer-iota.vercel.app)
- 公開リポジトリ：[shunsoco-stack/stone-viewer](https://github.com/shunsoco-stack/stone-viewer)
- UI・本番E2E・撮影の検証対象：Vercel deployment `dpl_Cas9JM6nZzTuG3t9YV9LdK57vZD3`
- 対象の状態：`READY` / `production` / Next.js 16.3.3 / Node.js 24
- Vercel上の本番ビルド：成功（出力生成19秒）。全ページを静的生成。

この記録は確認時点の結果です。画像・ドキュメントだけの後続デプロイや、その後のコード変更を自動的に検証済みとするものではありません。

## 品質チェック

| 検査 | 結果 |
| --- | --- |
| `npm run lint` | 成功・警告0 |
| `npm run typecheck` | 成功 |
| `npm run test` | 64件成功 |
| `npm run build` | ローカル・Vercelとも成功 |
| `npm audit` | 脆弱性報告0件 |
| 補助Secret Scan | 検出0件 |
| スキャナー自己テスト | 合成データ9件成功 |
| Playwright 本番E2E | 30件成功（機能24・アクセシビリティ6） |
| ダーク初期表示の追加回帰検査 | 新規ブラウザで3回成功 |
| 本番PWA検証 | 8項目成功・予期しないUI/通信エラー0 |
| 本番スクリーンショット | 指定5枚・全てWebGL・ブラウザ例外0 |

Secret Scanの対象・限界とGitHubの保護設定は[security.md](security.md)を参照してください。
継続的なチェックは[GitHub Actions](https://github.com/shunsoco-stack/stone-viewer/actions/workflows/quality.yml)で確認できます。

## 実操作で確認したこと

- ドラッグで角度は変わらず、ボタン1回で累計1度・描画のY軸角度が`π / 180`になる。
- 実際に360回押すと累計360度・一周記念が表示され、その後361度へ進める。
- 広告風演出は実際の5秒間を待つ。非表示時は停止し、中断では回転せず、完了後の受け取りで1度だけ増える。
- 再読み込み後も石・角度・本日の記録を保持し、保存禁止時もメモリ内で動く。
- 共有のキャンセル・コピー成功・コピー拒否時の手動共有、全画面APIと非対応時の案内。
- 石の名前変更、禅モード、テーマ切り替え、ダイアログのフォーカス復帰、キーボード操作。
- 320px / 390px幅を含むモバイル表示に横方向のはみ出しがない。
- WebGL未対応・コンテキスト喪失・軽量指定時はSVGへ切り替わり、操作を続けられる。

通常表示、ダーク表示、モバイル、説明ダイアログ、広告風演出、禅モードをaxe-coreのWCAG A/AA対象で検査しました。
自動検査は人による全てのアクセシビリティ検証を代替するものではありません。

## 描画負荷と修正の確認

描画は最大30fps・device pixel ratio最大1.5。非表示時は停止し、動きを減らす設定では静止中に描画しません。
表示の切り替え時にGPUのgeometry・material・textureを解放することも確認しました。
このブラウザ検証はChromiumのソフトウェアWebGLで実施しており、全端末の実測性能を保証するものではありません。

初回の本番検査で、動きを減らす設定に残った微小なトランジションが、継承された文字色の切り替えを遅らせる問題を検出しました。
同設定ではアニメーションとトランジションを完全に無効化し、E2E30件とダーク表示の追加3回を再実行して成功しています。
本番CSS最適化時に消えていた標準`backdrop-filter`も宣言順を修正し、実際の撮影で確認しました。

## 本番の配信・画像

トップページ、`robots.txt`、`sitemap.xml`、`og.png`、`favicon.ico`、`manifest.webmanifest`のHTTP 200を確認しました。
canonical・OG URL・サイトマップは実際の公開ドメインを参照しています。
対象デプロイを限定したVercel CLIのエラーレベルログ検索でも、確認時点の該当ログはありませんでした。

撮影データは[screenshots.json](screenshots.json)、画像は[`public/screenshots/`](../public/screenshots/)に保存しています。
撮影用の独立ブラウザで0度から開始し、すべて実際のUI操作で進めました。記念演出のために359度へ書き換える処理や、DOMの画像置換は使っていません。

## 計測・公開運用の制約

無料のVercel Web Analyticsはプロジェクトで有効です。独自イベントの実装はありますが、Hobbyプランでは収集できないため既定で無効にしています。
有料プラン・アドオン・トライアルへの変更は行っていません。独自イベントをページビューに偽装していません。
独自イベントの集計と、ダッシュボードに反映された実ユーザー統計の確認は未実施です。
本番SDKのGET 200は確認しました。Playwrightのheadless環境ではSDKが`webdriver` / `Headless`を判定して送信しないことを配信コードで確認したため、ページビューPOSTの受信済みとは扱っていません。
検証のために自動操作の判定を偽装したり、計測リクエストを手動送信したりしていません。

Vercelへの公開はCLIで実施しました。GitHubとの自動デプロイ連携は未接続のため、pushだけでは本番が更新されません。
再デプロイの手順は[README](../README.md#公開)に記載しています。

## PWAの実ブラウザ検証

2026年8月27日14:06（日本時間）、公開URLに対する`scripts/verify-pwa.mjs`の8項目が成功しました。

1. Service Workerの有効化・ページ制御と、初回Next.js資源のキャッシュ。
2. manifestとPNGアイコンの正しい寸法（192 / 512 / maskable 512）。
3. Service Workerの再検証・CSPなどのセキュリティヘッダー。
4. Chromiumのインストール要件検査（`installabilityErrors: []`）。
5. 通常のHTTPキャッシュを消して無効にし、ネットワーク切断後にキャッシュから起動。WebGL再表示・1度回転・シード・角度・日別時間の保持。
6. オンライン復帰、Service Workerの更新確認、Analyticsをキャッシュしていないこと。
7. Three.js未取得の別のブラウザで、オフラインのSVGフォールバックと操作・記録保持。
8. 再接続・再読み込み後のWebGL復帰と、オフラインで増やした角度の保持。

オフライン時のAnalytics・RSCの通信失敗と、意図的に未取得にしたThree.jsの読み込み失敗は診断として区別しています。
実際のOSへのインストール・standaloneウィンドウ起動・異なるリリース間での更新は未検証です。
実行ログはローカルの`.local/pwa-production.json`に保存しています。再現用スクリプトはリポジトリに含めています。

## 再実行

```sh
npm run verify
PLAYWRIGHT_BASE_URL=https://stone-viewer-iota.vercel.app npm run test:e2e
node scripts/verify-pwa.mjs https://stone-viewer-iota.vercel.app
npm run screenshots -- https://stone-viewer-iota.vercel.app
```

PowerShellでは、E2Eの前に`$env:PLAYWRIGHT_BASE_URL = 'https://stone-viewer-iota.vercel.app'`を設定し、別行で`npm run test:e2e`を実行してください。
