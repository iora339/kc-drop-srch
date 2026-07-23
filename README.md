# kc-drop-srch — 艦これ ドロップ検索ツール

`public/data/*.json` を読み込み、海域グリッド上に艦のドロップ有無を勝利ランク（S/A/B）で表示する静的サイト。React 19 + TypeScript + Vite 構成。

## コマンド

```sh
npm run dev      # 開発サーバ（http://localhost:5173）
npm run build    # 型チェック + 本番ビルド（tsc -b && vite build）
npm run preview  # ビルド結果のプレビュー
npm run lint     # oxlint
```

## データ

- `public/data/index.json` … 海域一覧・難易度・更新日時
- `public/data/<map>.json` … 海域ごとのマス × 難易度 × ドロップ
- `public/data/dupes.json` / `rank_drops.json` … 艦ごとのドロップ率詳細
- `public/data/ships.json` / `ship-type.json` … 艦娘・艦種マスタ

## デプロイ

Vite の `base` は `/kc-drop-srch/`（サブパス配信）。`main` ブランチへの push で GitHub Actions（`.github/workflows/deploy.yml`）が自動的に GitHub Pages へデプロイする。

公開URL: https://iora339.github.io/kc-drop-srch/
