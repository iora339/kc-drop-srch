import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  DropEntry,
  DupeEntry,
  DupeSample,
  DupesData,
  IndexData,
  MapData,
  MasterShip,
  NodeData,
  RankDropEntry,
  RankDropsData,
  ShipDupes,
  ShipRankDrops,
  ShipType,
} from './types'
import './App.css'

const DATA_BASE = `${import.meta.env.BASE_URL}data/`
const DIFF_STORAGE_KEY = 'kc-drop-srch:selectedDifficulties'

function loadSavedDifficulties(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DIFF_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

// フッタに表示するバージョン。package.json の version と揃える
const APP_VERSION = 'v0.1.0'

const DIFF_ORDER = ['甲', '乙', '丙', '丁']
const RANK_ORDER = ['S', 'A', 'B']
const OWNED_BUCKETS = [0, 1, 2, 3]

const DUPES_CAVEAT =
  '「-」はドロップ実績なし。所持数が多い箇所は母数が小さくブレやすい点に注意してください。'
const RANK_DROPS_NOTE =
  'レア艦は所持数を区別せず合算したドロップ率を確認できます。' +
  '所持制限はドロップが確認できた最大の既所持数です。数字よりも多く所持している場合はドロップしない可能性があります。'

const compareDifficulty = (a: string, b: string) =>
  DIFF_ORDER.indexOf(a) - DIFF_ORDER.indexOf(b)
const compareRank = (a: string, b: string) => RANK_ORDER.indexOf(a) - RANK_ORDER.indexOf(b)

// 海域・マス・難度・ランクが揃うエントリの既定並び順(難度→海域→マス→勝利ランク)
function compareEntryDefault(
  a: { difficulty: string; map: string; node: string; rank: string },
  b: { difficulty: string; map: string; node: string; rank: string },
  mapOrder: (mapId: string) => number,
): number {
  return (
    compareDifficulty(a.difficulty, b.difficulty) ||
    mapOrder(a.map) - mapOrder(b.map) ||
    a.node.localeCompare(b.node) ||
    compareRank(a.rank, b.rank)
  )
}

// 所持数バケットのドロップ率を集計。実績0・母数0は表示「-」。
// plus=true のとき owned>=count を合算(4隻以上用)。
// text: セル表示、title: ドロップ数/母数(母数0なら空)、value: ソート用の数値(母数0は-1)。
function bucketPct(
  dupes: DupeSample[],
  count: number,
  plus = false,
): { text: string; title: string; value: number } {
  let drops = 0
  let total = 0
  for (const d of dupes) {
    if (plus ? d.owned >= count : d.owned === count) {
      drops += d.drops
      total += d.total
    }
  }
  const title = total === 0 ? '' : `${drops}/${total}`
  const value = total === 0 ? -1 : (drops / total) * 100
  if (total === 0 || drops === 0) return { text: '-', title, value }
  return { text: `${value.toFixed(1)}%`, title, value }
}

type SortDir = 'asc' | 'desc'

// テーブルのクリックソート状態(現在のキー・方向)と、ヘッダー用のトグル操作・矢印表示をまとめて提供する
function useSortState<K>() {
  const [sort, setSort] = useState<{ key: K; dir: SortDir } | null>(null)

  const toggleSort = (key: K, defaultDir: SortDir) => {
    setSort((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: defaultDir },
    )
  }

  const sortIndicator = (key: K): ReactNode =>
    sort && sort.key === key ? (
      sort.dir === 'asc' ? ' ▲' : ' ▼'
    ) : (
      <span className="sort-hint"> ⇅</span>
    )

  return { sort, toggleSort, sortIndicator }
}

// マス表向けテーブルの勝利ランク(S/A)絞り込み状態
function useRankFilter() {
  const [rankFilter, setRankFilter] = useState<Set<string>>(new Set())

  const toggleRankFilter = (rank: string) => {
    setRankFilter((prev) => {
      const next = new Set(prev)
      if (next.has(rank)) next.delete(rank)
      else next.add(rank)
      return next
    })
  }

  return { rankFilter, toggleRankFilter }
}

function RankFilterButtons({
  rankFilter,
  onToggle,
}: {
  rankFilter: Set<string>
  onToggle: (rank: string) => void
}) {
  return (
    <div className="rank-filter">
      {['S', 'A'].map((rank) => (
        <button
          key={rank}
          type="button"
          className={
            `rank-filter-btn rank-${rank}` + (rankFilter.has(rank) ? ' active' : '')
          }
          aria-pressed={rankFilter.has(rank)}
          onClick={() => onToggle(rank)}
        >
          {rank}
        </button>
      ))}
    </div>
  )
}

// ドロップ率セル(メイン表示 + 母数のサブ表示)。titleが空ならサブ表示なし。
function PctCell({ text, title }: { text: string; title: string }) {
  return (
    <td className="dupes-pct">
      <span className="dupes-pct-main">{text}</span>
      {title && <span className="dupes-pct-sub">{title}</span>}
    </td>
  )
}

// 所持数 0〜3隻 + 4隻以上のドロップ率セル一式(DupesTable/NodeDupesTable で共用)
function OwnedBucketCells({ dupes }: { dupes: DupeSample[] }) {
  const plus = bucketPct(dupes, 4, true)
  return (
    <>
      {OWNED_BUCKETS.map((n) => {
        const cell = bucketPct(dupes, n)
        return <PctCell key={n} text={cell.text} title={cell.title} />
      })}
      <PctCell text={plus.text} title={plus.title} />
    </>
  )
}

// 所持数バケット列のヘッダー(n隻/4隻以上のソートボタン行)。
// key の型は呼び出し元の SortKey/NodeSortKey が number | 'plus' を包含するため共用できる。
function OwnedBucketHeaderCells({
  toggleSort,
  sortIndicator,
}: {
  toggleSort: (key: number | 'plus', dir: SortDir) => void
  sortIndicator: (key: number | 'plus') => ReactNode
}) {
  return (
    <tr>
      {OWNED_BUCKETS.map((n) => (
        <th key={n} className="dupes-sortable" onClick={() => toggleSort(n, 'desc')}>
          {n}隻{sortIndicator(n)}
        </th>
      ))}
      <th className="dupes-sortable" onClick={() => toggleSort('plus', 'desc')}>
        4隻以上{sortIndicator('plus')}
      </th>
    </tr>
  )
}

// 難度・海域・マス・勝利ランクの並び替え可能ヘッダー(DupesTable/RankDropsTable で共用)
function EntryHeaderCells({
  rowSpan,
  toggleSort,
  sortIndicator,
}: {
  rowSpan?: number
  toggleSort: (key: 'difficulty' | 'map' | 'node' | 'rank', dir: SortDir) => void
  sortIndicator: (key: 'difficulty' | 'map' | 'node' | 'rank') => ReactNode
}) {
  return (
    <>
      <th
        rowSpan={rowSpan}
        className="dupes-sortable dupes-col-narrow"
        onClick={() => toggleSort('difficulty', 'asc')}
      >
        難度{sortIndicator('difficulty')}
      </th>
      <th
        rowSpan={rowSpan}
        className="dupes-sortable dupes-col-narrow"
        onClick={() => toggleSort('map', 'asc')}
      >
        海域{sortIndicator('map')}
      </th>
      <th
        rowSpan={rowSpan}
        className="dupes-sortable dupes-col-narrow"
        onClick={() => toggleSort('node', 'asc')}
      >
        マス{sortIndicator('node')}
      </th>
      <th
        rowSpan={rowSpan}
        className="dupes-sortable dupes-col-narrow"
        onClick={() => toggleSort('rank', 'asc')}
      >
        勝利{sortIndicator('rank')}
      </th>
    </>
  )
}

// 難度・海域・マス・勝利ランクの表示セル(DupesTable/RankDropsTable で共用)
function EntryBodyCells({
  entry,
  mapLabels,
  onSelectNode,
}: {
  entry: { map: string; difficulty: string; node: string; rank: string }
  mapLabels: Record<string, string>
  onSelectNode: (mapId: string, node: string) => void
}) {
  return (
    <>
      <td className="dupes-col-narrow">{entry.difficulty}</td>
      <td className="dupes-col-narrow">{mapLabels[entry.map] ?? entry.map}</td>
      <td
        className="dupes-col-narrow dupes-clickable"
        onClick={() => onSelectNode(entry.map, entry.node)}
      >
        {entry.node}
      </td>
      <td className={`dupes-rank dupes-col-narrow rank-${entry.rank}`}>{entry.rank}</td>
    </>
  )
}

// 艦名(クリックで艦選択に遷移)+勝利ランクのセル。新規実装艦はバッジ表示。
function ShipRankCells({
  shipId,
  shipName,
  isNew = false,
  rank,
  onSelectShip,
}: {
  shipId: number
  shipName: string
  isNew?: boolean
  rank: string
  onSelectShip: (shipId: number) => void
}) {
  return (
    <>
      <td
        className="dupes-col-narrow dupes-clickable"
        onClick={() => onSelectShip(shipId)}
      >
        {isNew ? <span className="dupes-ship-new">{shipName}</span> : shipName}
      </td>
      <td className={`dupes-rank dupes-col-narrow rank-${rank}`}>{rank}</td>
    </>
  )
}

// レア艦向けドロップ率のヘッダー(RankDropsTable/NodeRankDropsTable で共用)
function RankPctHeaderCells({
  toggleSort,
  sortIndicator,
}: {
  toggleSort: (key: 'pct' | 'dupes', dir: SortDir) => void
  sortIndicator: (key: 'pct' | 'dupes') => ReactNode
}) {
  return (
    <>
      <th className="dupes-sortable" onClick={() => toggleSort('pct', 'desc')}>
        ドロップ率{sortIndicator('pct')}
      </th>
      <th className="dupes-sortable" onClick={() => toggleSort('dupes', 'desc')}>
        所持制限{sortIndicator('dupes')}
      </th>
    </>
  )
}

// レア艦向けドロップ率のセル(ドロップ率+所持制限)。RankDropsTable/NodeRankDropsTable で共用。
function RankPctCells({
  drops,
  total,
  pct,
  dupesLimit,
}: {
  drops: number
  total: number
  pct: number | null
  dupesLimit: number | null
}) {
  const noData = total === 0 || drops === 0
  return (
    <>
      <PctCell text={noData ? '-' : `${pct}%`} title={total > 0 ? `${drops}/${total}` : ''} />
      <td className="dupes-pct">{dupesLimit ?? '-'}</td>
    </>
  )
}

// 所持数バケットのソートキー(隻数 or 'plus')比較。DupesTable/NodeDupesTable で共用。
const compareBucket = (a: DupeSample[], b: DupeSample[], key: number | 'plus'): number =>
  key === 'plus'
    ? bucketPct(a, 4, true).value - bucketPct(b, 4, true).value
    : bucketPct(a, key).value - bucketPct(b, key).value

// レア艦のドロップ率/所持制限の比較。RankDropsTable/NodeRankDropsTable で共用。
const compareRankPct = (
  a: { total: number; pct: number | null; dupes: number | null },
  b: { total: number; pct: number | null; dupes: number | null },
  key: 'pct' | 'dupes',
): number =>
  key === 'dupes'
    ? (a.dupes ?? -1) - (b.dupes ?? -1)
    : (a.total > 0 ? (a.pct ?? 0) : -1) - (b.total > 0 ? (b.pct ?? 0) : -1)

// 選択中の難易度の行のみ表示(全難度モード時は絞らない)。DupesTable/RankDropsTable で共用。
function filterByDifficulty<T extends { map: string; difficulty: string }>(
  entries: T[],
  showAll: boolean,
  mapDiffName: Record<string, string>,
): T[] {
  return entries.filter((e) => showAll || mapDiffName[e.map] === e.difficulty)
}

// マス選択表向け: 難度を確定させた上でランクフィルタを適用。NodeDupesTable/NodeRankDropsTable で共用。
function filterNodeRows<T extends { difficulty: string; rank: string }>(
  rows: T[],
  difficultyName: string,
  rankFilter: Set<string>,
): T[] {
  return rows
    .filter((r) => r.difficulty === difficultyName)
    .filter((r) => rankFilter.size === 0 || rankFilter.has(r.rank))
}

// クリックソート未指定時は既定順、指定時はキー比較→既定順でタイブレーク。4テーブル共通のソート適用処理。
function sortWithFallback<T, K>(
  items: T[],
  sort: { key: K; dir: SortDir } | null,
  compareByKey: (a: T, b: T, key: K) => number,
  defaultCompare: (a: T, b: T) => number,
): T[] {
  return [...items].sort((a, b) => {
    if (!sort) return defaultCompare(a, b)
    const cmp = compareByKey(a, b, sort.key)
    return (sort.dir === 'asc' ? cmp : -cmp) || defaultCompare(a, b)
  })
}

// 横スクロール付きテーブルのラッパー(全テーブルで共用)
function ScrollTable({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className="dupes-scroll">
      <table className={`dupes-table${className ? ` ${className}` : ''}`}>
        {children}
      </table>
    </div>
  )
}

// 列幅を固定するための colgroup 一式。
// 内容依存(table-layout: auto)のままにすると、艦やマスを切り替えるたびに
// 分母の桁数・艦名やマス名の長さで列幅が変わって表がずれる

// 艦選択時: 難度・海域・マス・勝利 + 所持数5列
function DupesColGroup() {
  return (
    <colgroup>
      <col className="dupes-col-diff" />
      <col className="dupes-col-map" />
      <col className="dupes-col-node" />
      <col className="dupes-col-rank" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket-plus" />
    </colgroup>
  )
}

// マス選択時(新規実装・ユニーク艦): 艦名・勝利 + 所持数5列
function NodeDupesColGroup() {
  return (
    <colgroup>
      <col className="dupes-col-ship" />
      <col className="dupes-col-rank" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket-plus" />
    </colgroup>
  )
}

// マス選択時(レア艦): 艦名・勝利・ドロップ率・所持制限
function NodeRankColGroup() {
  return (
    <colgroup>
      <col className="dupes-col-ship" />
      <col className="dupes-col-rank" />
      <col className="dupes-col-pct" />
      <col className="dupes-col-limit" />
    </colgroup>
  )
}

type SortKey = 'difficulty' | 'map' | 'node' | 'rank' | number | 'plus'

function DupesTable({
  ship,
  selectedShipName,
  mapLabels,
  mapOrder,
  mapDiffName,
  showAll,
  onToggleShowAll,
  onSelectNode,
}: {
  ship: ShipDupes | null
  selectedShipName: string | null
  mapLabels: Record<string, string>
  mapOrder: (mapId: string) => number
  mapDiffName: Record<string, string>
  showAll: boolean
  onToggleShowAll: () => void
  onSelectNode: (mapId: string, node: string) => void
}) {
  const { sort, toggleSort, sortIndicator } = useSortState<SortKey>()

  const compareByKey = (a: DupeEntry, b: DupeEntry, key: SortKey): number => {
    if (key === 'node') return a.node.localeCompare(b.node)
    if (key === 'difficulty') return compareDifficulty(a.difficulty, b.difficulty)
    if (key === 'map') return mapOrder(a.map) - mapOrder(b.map)
    if (key === 'rank') return compareRank(a.rank, b.rank)
    return compareBucket(a.dupes, b.dupes, key)
  }

  const rows = sortWithFallback(
    ship ? filterByDifficulty(ship.entries, showAll, mapDiffName) : [],
    sort,
    compareByKey,
    (a, b) => compareEntryDefault(a, b, mapOrder),
  )
  return (
    <div className="dupes card">
      <div className="dupes-head">
        <div className="dupes-title">
          {selectedShipName && (
            <span className="title-ship">{selectedShipName}</span>
          )}
          所持数別ドロップ率
        </div>
        <button
          type="button"
          className={
            'dupes-toggle' +
            (showAll ? ' active' : '') +
            (ship ? '' : ' hidden')
          }
          aria-pressed={showAll}
          disabled={!ship}
          onClick={onToggleShowAll}
        >
          全難度のドロップ率を表示
        </button>
      </div>
      {ship ? (
        <>
          <ScrollTable className="dupes-table-fixed">
            <DupesColGroup />
            <thead>
              <tr>
                <EntryHeaderCells rowSpan={2} toggleSort={toggleSort} sortIndicator={sortIndicator} />
                <th colSpan={5} className="dupes-owned-head">
                  所持数毎のドロップ率
                </th>
              </tr>
              <OwnedBucketHeaderCells toggleSort={toggleSort} sortIndicator={sortIndicator} />
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={i}>
                  <EntryBodyCells entry={e} mapLabels={mapLabels} onSelectNode={onSelectNode} />
                  <OwnedBucketCells dupes={e.dupes} />
                </tr>
              ))}
            </tbody>
          </ScrollTable>
          <p className="dupes-note">
            新規実装艦・ユニーク艦は所持数別のドロップ率を確認できます。
            {DUPES_CAVEAT}
          </p>
        </>
      ) : (
        <p className="dupes-empty">
          {selectedShipName
            ? `${selectedShipName} の所持数別ドロップ率データはありません。`
            : '艦やマスを選択すると、所持数別ドロップ率を表示します。'}
        </p>
      )}
    </div>
  )
}

type RankSortKey = 'difficulty' | 'map' | 'node' | 'rank' | 'pct' | 'dupes'

// レア艦向け: 所持数別の内訳を持たない、マス単位のそのままのドロップ率を表示。
function RankDropsTable({
  ship,
  selectedShipName,
  mapLabels,
  mapOrder,
  mapDiffName,
  showAll,
  onToggleShowAll,
  onSelectNode,
}: {
  ship: ShipRankDrops
  selectedShipName: string | null
  mapLabels: Record<string, string>
  mapOrder: (mapId: string) => number
  mapDiffName: Record<string, string>
  showAll: boolean
  onToggleShowAll: () => void
  onSelectNode: (mapId: string, node: string) => void
}) {
  const { sort, toggleSort, sortIndicator } = useSortState<RankSortKey>()

  const compareByKey = (
    a: RankDropEntry,
    b: RankDropEntry,
    key: RankSortKey,
  ): number => {
    if (key === 'node') return a.node.localeCompare(b.node)
    if (key === 'difficulty') return compareDifficulty(a.difficulty, b.difficulty)
    if (key === 'map') return mapOrder(a.map) - mapOrder(b.map)
    if (key === 'rank') return compareRank(a.rank, b.rank)
    return compareRankPct(a, b, key)
  }

  const rows = sortWithFallback(
    filterByDifficulty(ship.entries, showAll, mapDiffName),
    sort,
    compareByKey,
    (a, b) => compareEntryDefault(a, b, mapOrder),
  )

  return (
    <div className="dupes card">
      <div className="dupes-head">
        <div className="dupes-title">
          {selectedShipName && (
            <span className="title-ship">{selectedShipName}</span>
          )}
          ドロップ率
        </div>
        <button
          type="button"
          className={'dupes-toggle' + (showAll ? ' active' : '')}
          aria-pressed={showAll}
          onClick={onToggleShowAll}
        >
          全難度のドロップ率を表示
        </button>
      </div>
      <ScrollTable>
        <thead>
          <tr>
            <EntryHeaderCells toggleSort={toggleSort} sortIndicator={sortIndicator} />
            <RankPctHeaderCells toggleSort={toggleSort} sortIndicator={sortIndicator} />
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={i}>
              <EntryBodyCells entry={e} mapLabels={mapLabels} onSelectNode={onSelectNode} />
              <RankPctCells drops={e.drops} total={e.total} pct={e.pct} dupesLimit={e.dupes} />
            </tr>
          ))}
        </tbody>
      </ScrollTable>
      <p className="dupes-note">{RANK_DROPS_NOTE}</p>
    </div>
  )
}

type NodeSortKey = 'ship' | 'rank' | number | 'plus'

interface NodeDupeRow {
  shipId: number
  shipName: string
  rarity: number | null
  sortId: number
  difficulty: string
  rank: string
  dupes: DupeSample[]
}

// マス視点: 選択中マス(海域+難度+マス)にドロップ実績のある新規実装・ユニーク艦を一覧表示。
// 所持数別ドロップ率テーブルと同じ集計・列構成で、海域/マスの代わりに艦名を並べる。
// 難度はマス選択時点で1つに確定するためタイトルに含め、列としては持たない。
function NodeDupesTable({
  mapId,
  node,
  difficultyName,
  mapLabels,
  rows,
  onSelectShip,
}: {
  mapId: string
  node: string
  difficultyName: string
  mapLabels: Record<string, string>
  rows: NodeDupeRow[]
  onSelectShip: (shipId: number) => void
}) {
  const { sort, toggleSort, sortIndicator } = useSortState<NodeSortKey>()
  const { rankFilter, toggleRankFilter } = useRankFilter()

  const compareByKey = (a: NodeDupeRow, b: NodeDupeRow, key: NodeSortKey): number => {
    if (key === 'ship') return a.sortId - b.sortId
    if (key === 'rank') return compareRank(a.rank, b.rank)
    return compareBucket(a.dupes, b.dupes, key)
  }

  // 既定の並び順(新規実装艦を優先→艦の sortId 順→艦ID順→勝利ランク)。列ソート時はタイブレークに使う。
  // 新規実装艦は ships.json 未収録で sortId が全員同値になるため、艦IDでもう一段揃えないと
  // 勝利ランクが先に効いて同じ艦の行が離れてしまう。
  const defaultCompare = (a: NodeDupeRow, b: NodeDupeRow): number =>
    Number(a.rarity != null) - Number(b.rarity != null) ||
    a.sortId - b.sortId ||
    a.shipId - b.shipId ||
    compareRank(a.rank, b.rank)

  const rows_ = sortWithFallback(
    filterNodeRows(rows, difficultyName, rankFilter),
    sort,
    compareByKey,
    defaultCompare,
  )

  return (
    <div className="dupes card">
      <div className="dupes-head">
        <div className="dupes-title">
          <span className="title-ship">
            {mapLabels[mapId] ?? mapId}-{node} {difficultyName}
          </span>
          所持数別ドロップ率
        </div>
        <RankFilterButtons rankFilter={rankFilter} onToggle={toggleRankFilter} />
      </div>
      {rows_.length > 0 ? (
        <>
          <ScrollTable className="node-dupes-table-fixed">
            <NodeDupesColGroup />
            <thead>
              <tr>
                <th
                  rowSpan={2}
                  className="dupes-sortable dupes-col-narrow"
                  onClick={() => toggleSort('ship', 'asc')}
                >
                  艦名{sortIndicator('ship')}
                </th>
                <th
                  rowSpan={2}
                  className="dupes-sortable dupes-col-narrow"
                  onClick={() => toggleSort('rank', 'asc')}
                >
                  勝利{sortIndicator('rank')}
                </th>
                <th colSpan={5} className="dupes-owned-head">
                  所持数毎のドロップ率
                </th>
              </tr>
              <OwnedBucketHeaderCells toggleSort={toggleSort} sortIndicator={sortIndicator} />
            </thead>
            <tbody>
              {rows_.map((r, i) => (
                <tr key={i}>
                  <ShipRankCells
                    shipId={r.shipId}
                    shipName={r.shipName}
                    isNew={r.rarity == null}
                    rank={r.rank}
                    onSelectShip={onSelectShip}
                  />
                  <OwnedBucketCells dupes={r.dupes} />
                </tr>
              ))}
            </tbody>
          </ScrollTable>
          <p className="dupes-note">
            新規実装艦・ユニーク艦のうち、このマスにドロップ実績がある艦を表示しています。
            {DUPES_CAVEAT}
          </p>
        </>
      ) : (
        <p className="dupes-empty">
          このマスには新規実装艦・ユニーク艦のドロップ実績がありません。
        </p>
      )}
    </div>
  )
}

type NodeRankSortKey = 'ship' | 'rank' | 'pct' | 'dupes'

interface NodeRankRow {
  shipId: number
  shipName: string
  sortId: number
  difficulty: string
  rank: string
  drops: number
  total: number
  pct: number | null
  dupes: number | null
}

// マス視点: 選択中マスにドロップ実績があるレア艦を一覧表示。所持数の内訳を持たないため
// NodeDupesTable とは別テーブルにし、RankDropsTable と同じ列構成(艦名・勝利・ドロップ率・所持制限)にする。
function NodeRankDropsTable({
  mapId,
  node,
  difficultyName,
  mapLabels,
  rows,
  onSelectShip,
}: {
  mapId: string
  node: string
  difficultyName: string
  mapLabels: Record<string, string>
  rows: NodeRankRow[]
  onSelectShip: (shipId: number) => void
}) {
  const { sort, toggleSort, sortIndicator } = useSortState<NodeRankSortKey>()
  const { rankFilter, toggleRankFilter } = useRankFilter()

  const compareByKey = (a: NodeRankRow, b: NodeRankRow, key: NodeRankSortKey): number => {
    if (key === 'ship') return a.sortId - b.sortId
    if (key === 'rank') return compareRank(a.rank, b.rank)
    return compareRankPct(a, b, key)
  }

  // 既定の並び順(艦の sortId 順→艦ID順→勝利ランク)。列ソート時はタイブレークに使う。
  // 艦IDを挟むのは NodeDupesTable と同じ理由(sortId 同値時に同じ艦の行が離れるのを防ぐ)。
  const defaultCompare = (a: NodeRankRow, b: NodeRankRow): number =>
    a.sortId - b.sortId || a.shipId - b.shipId || compareRank(a.rank, b.rank)

  const rows_ = sortWithFallback(
    filterNodeRows(rows, difficultyName, rankFilter),
    sort,
    compareByKey,
    defaultCompare,
  )

  return (
    <div className="dupes card">
      <div className="dupes-head">
        <div className="dupes-title">
          <span className="title-ship">
            {mapLabels[mapId] ?? mapId}-{node} {difficultyName}
          </span>
          レア艦のドロップ率
        </div>
        <RankFilterButtons rankFilter={rankFilter} onToggle={toggleRankFilter} />
      </div>
      {rows_.length > 0 ? (
        <>
          <ScrollTable className="node-rank-table-fixed">
            <NodeRankColGroup />
            <thead>
              <tr>
                <th
                  className="dupes-sortable dupes-col-narrow"
                  onClick={() => toggleSort('ship', 'asc')}
                >
                  艦名{sortIndicator('ship')}
                </th>
                <th
                  className="dupes-sortable dupes-col-narrow"
                  onClick={() => toggleSort('rank', 'asc')}
                >
                  勝利{sortIndicator('rank')}
                </th>
                <RankPctHeaderCells toggleSort={toggleSort} sortIndicator={sortIndicator} />
              </tr>
            </thead>
            <tbody>
              {rows_.map((r, i) => (
                <tr key={i}>
                  <ShipRankCells
                    shipId={r.shipId}
                    shipName={r.shipName}
                    rank={r.rank}
                    onSelectShip={onSelectShip}
                  />
                  <RankPctCells drops={r.drops} total={r.total} pct={r.pct} dupesLimit={r.dupes} />
                </tr>
              ))}
            </tbody>
          </ScrollTable>
          <p className="dupes-note">{RANK_DROPS_NOTE}</p>
        </>
      ) : (
        <p className="dupes-empty">このマスにはレア艦のドロップ実績がありません。</p>
      )}
    </div>
  )
}

interface Ship {
  id: number
  name: string
  nameEn: string
  rarity: number | null
  typeName: string
  sortId: number
  /** その艦がドロップする最も早い海域の並び順(新規実装艦の表示順に使用) */
  firstMapOrder: number
  /** 上記の海域内で最も早いマスの並び順(マスグリッドの列順に対応) */
  firstNodeOrder: number
}

// 最低勝利ランク(B > A > S の順で緩い方を優先)
function minRank(ranks: DropEntry['ranks']): string {
  if (ranks.b) return 'B'
  if (ranks.a) return 'A'
  if (ranks.s) return 'S'
  return ''
}

function MapGrid({
  mapLabels,
  mapAllNodes,
  mapNodes,
  difficulties,
  selectedDifficulties,
  onSelectDifficulty,
  selectedShipId,
  selectedShipName,
  allSameDifficulty,
  onSelectAllDifficulties,
  selectedNode,
  onSelectNode,
}: {
  mapLabels: Record<string, string>
  mapAllNodes: Record<string, NodeData[]>
  mapNodes: Record<string, NodeData[]>
  difficulties: { id: number; name: string }[]
  selectedDifficulties: Record<string, number>
  onSelectDifficulty: (mapId: string, difficulty: number) => void
  selectedShipId: number | null
  selectedShipName: string | null
  allSameDifficulty: number | null
  onSelectAllDifficulties: (difficulty: number) => void
  selectedNode: { map: string; node: string } | null
  onSelectNode: (mapId: string, node: string) => void
}) {
  return (
    <div className="map-grid">
      <div className="grid-title">
        {selectedShipName && (
          <span className="title-ship">{selectedShipName}</span>
        )}
        海域別ドロップ条件
      </div>
      <nav className="difficulty-all">
        <span className="difficulty-all-label">全海域一括:</span>
        {difficulties.map((d) => (
          <button
            key={d.id}
            className={d.id === allSameDifficulty ? 'active' : ''}
            onClick={() => onSelectAllDifficulties(d.id)}
          >
            {d.name}
          </button>
        ))}
      </nav>
      {Object.entries(mapAllNodes).map(([mapId, dropNodes]) => {
        const currentNodes = mapNodes[mapId] ?? []
        const isSelectedNode = (node: string) =>
          selectedNode?.map === mapId && selectedNode.node === node
        return (
          <table key={mapId} className="map-grid-table">
            <tbody>
              <tr>
                <th rowSpan={2} className="map-grid-map">
                  <div className="map-grid-map-inner">
                    <span>{mapLabels[mapId] ?? mapId}</span>
                    <select
                      value={selectedDifficulties[mapId] ?? ''}
                      onChange={(e) =>
                        onSelectDifficulty(mapId, Number(e.target.value))
                      }
                    >
                      {difficulties.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </th>
                {dropNodes.map((n) => (
                  <td
                    key={n.node}
                    className={
                      'map-grid-node' +
                      (n.boss ? ' boss' : '') +
                      (isSelectedNode(n.node) ? ' selected' : '')
                    }
                    title={n.boss ? 'ボスマス' : undefined}
                    onClick={() => onSelectNode(mapId, n.node)}
                  >
                    {n.node}
                  </td>
                ))}
              </tr>
              <tr>
                {dropNodes.map((n) => {
                  const currentNode = currentNodes.find(
                    (cn) => cn.node === n.node,
                  )
                  const drop =
                    selectedShipId == null || !currentNode
                      ? undefined
                      : currentNode.drops.find((d) => d.id === selectedShipId)
                  const rank = drop ? minRank(drop.ranks) : ''
                  return (
                    <td
                      key={n.node}
                      className={
                        'map-grid-rank' +
                        (rank ? ` rank-${rank}` : '') +
                        (isSelectedNode(n.node) ? ' selected' : '')
                      }
                      onClick={() => onSelectNode(mapId, n.node)}
                    >
                      {rank}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        )
      })}
      <p className="dupes-note">
        ランク表記は「その勝利ランク以上でドロップ確認済み」。赤字のマスはボスマス。
      </p>
    </div>
  )
}

function App() {
  const [index, setIndex] = useState<IndexData | null>(null)
  const [maps, setMaps] = useState<Record<string, MapData>>({})
  const [masterShips, setMasterShips] = useState<MasterShip[]>([])
  const [shipTypes, setShipTypes] = useState<ShipType[]>([])
  const [dupes, setDupes] = useState<DupesData | null>(null)
  const [rankDrops, setRankDrops] = useState<RankDropsData | null>(null)
  const [selectedDifficulties, setSelectedDifficulties] = useState<
    Record<string, number>
  >({})
  const [selectedShipId, setSelectedShipId] = useState<number | null>(null)
  const [selectedNode, setSelectedNode] = useState<{
    map: string
    node: string
  } | null>(null)
  const [showAllRates, setShowAllRates] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const [idx, master, types, dupesData, rankDropsData] = await Promise.all([
          fetch(`${DATA_BASE}index.json`).then((r) => r.json() as Promise<IndexData>),
          fetch(`${DATA_BASE}ships.json`).then((r) => r.json() as Promise<MasterShip[]>),
          fetch(`${DATA_BASE}ship-type.json`).then((r) => r.json() as Promise<ShipType[]>),
          fetch(`${DATA_BASE}dupes.json`)
            .then((r) => (r.ok ? (r.json() as Promise<DupesData>) : null))
            .catch(() => null),
          fetch(`${DATA_BASE}rank_drops.json`)
            .then((r) => (r.ok ? (r.json() as Promise<RankDropsData>) : null))
            .catch(() => null),
        ])
        setIndex(idx)
        setMasterShips(master)
        setShipTypes(types)
        setDupes(dupesData)
        setRankDrops(rankDropsData)
        // 各海域とも最も高い難易度(甲)をデフォルト選択。保存済みの選択があれば復元する
        const maxDiff = idx.difficulties.reduce(
          (max, d) => (d.id > max ? d.id : max),
          idx.difficulties[0]?.id ?? 4,
        )
        const validDiffIds = new Set(idx.difficulties.map((d) => d.id))
        const saved = loadSavedDifficulties()
        const initialDiffs: Record<string, number> = {}
        idx.maps.forEach((m) => {
          const savedDiff = saved[m.id]
          initialDiffs[m.id] =
            savedDiff != null && validDiffIds.has(savedDiff) ? savedDiff : maxDiff
        })
        setSelectedDifficulties(initialDiffs)
        const mapEntries = await Promise.all(
          idx.maps.map(
            async (m) =>
              [m.id, await fetch(`${DATA_BASE}${m.id}.json`).then((r) => r.json())] as const,
          ),
        )
        setMaps(Object.fromEntries(mapEntries))
      } catch {
        setError('データの読み込みに失敗しました')
      }
    })()
  }, [])

  // 難易度選択を localStorage に保存し、再読み込み後も引き継ぐ
  useEffect(() => {
    if (Object.keys(selectedDifficulties).length === 0) return
    localStorage.setItem(DIFF_STORAGE_KEY, JSON.stringify(selectedDifficulties))
  }, [selectedDifficulties])

  // 海域ID -> E1/E2/... の対応(index.json の並び順から生成)
  const mapLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    index?.maps.forEach((m, i) => {
      labels[m.id] = `E${i + 1}`
    })
    return labels
  }, [index])

  // 海域IDの並び順(dupes 表の海域ソート用)
  const mapOrder = useMemo(() => {
    const idx = new Map(index?.maps.map((m, i) => [m.id, i]))
    return (mapId: string) => idx.get(mapId) ?? Number.MAX_SAFE_INTEGER
  }, [index])

  // 海域ID -> 選択中の難易度名(dupes 表のフィルタ用)
  const mapDiffName = useMemo(() => {
    const byId = new Map(index?.difficulties.map((d) => [d.id, d.name]))
    const res: Record<string, string> = {}
    for (const [mapId, diffId] of Object.entries(selectedDifficulties)) {
      const name = byId.get(diffId)
      if (name) res[mapId] = name
    }
    return res
  }, [index, selectedDifficulties])

  // 海域ごとのマス列(全難易度の和集合、難易度切替でマス構成自体は変わらない固定リスト)
  // レア以上(rarity 1/2/null)の艦が落ちるマスのみを列に含める(common艦しか落ちない
  // マスは選択対象の艦が存在せず常に空欄になるため除外)
  const mapAllNodes = useMemo(() => {
    const result: Record<string, NodeData[]> = {}
    for (const [mapId, mapData] of Object.entries(maps)) {
      const diffLists = Object.values(mapData.difficulties)
      if (diffLists.length === 0) continue
      const template = diffLists[0].nodes
      const rareNodeNames = new Set<string>()
      for (const d of diffLists) {
        for (const n of d.nodes) {
          if (
            n.drops.some(
              (dr) => dr.rarity === 1 || dr.rarity === 2 || dr.rarity == null,
            )
          )
            rareNodeNames.add(n.node)
        }
      }
      result[mapId] = template.filter((n) => rareNodeNames.has(n.node))
    }
    return result
  }, [maps])

  // 海域ごとに選択中の難易度のノード一覧
  const mapNodes = useMemo(() => {
    const result: Record<string, NodeData[]> = {}
    for (const [mapId, mapData] of Object.entries(maps)) {
      const diff = selectedDifficulties[mapId]
      if (diff == null) continue
      result[mapId] = mapData.difficulties[String(diff)]?.nodes ?? []
    }
    return result
  }, [maps, selectedDifficulties])

  // ドロップに登場する rarity 1 / 2 / null の艦一覧(全海域・全難易度から重複排除、艦種名を付与)
  // 難易度タブを切り替えてもボタン構成自体は変わらない固定リスト
  const ships = useMemo(() => {
    const masterById = new Map(masterShips.map((m) => [m.id, m]))
    const typeNameMerge: Record<string, string> = {
      装甲空母: '正規空母',
      潜水空母: '潜水艦',
    }
    const typeNameById = new Map(
      shipTypes.map((t) => [t.id, typeNameMerge[t.name] ?? t.name]),
    )
    const byId = new Map<number, Ship>()
    // Object.entries の順は index.maps の順と一致する保証がないため、
    // 海域の早さは mapOrder で判定する
    for (const [mapId, mapData] of Object.entries(maps)) {
      const order = mapOrder(mapId)
      // マスの早さはマスグリッドの列順(mapAllNodes)に合わせる
      const nodeIdx = new Map(
        (mapAllNodes[mapId] ?? []).map((n, i) => [n.node, i]),
      )
      for (const diffData of Object.values(mapData.difficulties)) {
        for (const node of diffData.nodes) {
          const nodeOrder = nodeIdx.get(node.node) ?? Number.MAX_SAFE_INTEGER
          for (const d of node.drops) {
            if (d.rarity === 1 || d.rarity === 2 || d.rarity == null) {
              const cur = byId.get(d.id)
              if (cur) {
                if (
                  order < cur.firstMapOrder ||
                  (order === cur.firstMapOrder &&
                    nodeOrder < cur.firstNodeOrder)
                ) {
                  cur.firstMapOrder = order
                  cur.firstNodeOrder = nodeOrder
                }
              } else {
                const master = masterById.get(d.id)
                byId.set(d.id, {
                  id: d.id,
                  name: d.name,
                  nameEn: d.nameEn,
                  rarity: d.rarity,
                  typeName: master
                    ? typeNameById.get(master.shipType) ?? '艦種不明'
                    : '艦種不明',
                  sortId: master?.sortId ?? Number.MAX_SAFE_INTEGER,
                  firstMapOrder: order,
                  firstNodeOrder: nodeOrder,
                })
              }
            }
          }
        }
      }
    }
    return [...byId.values()]
  }, [maps, masterShips, shipTypes, mapOrder, mapAllNodes])

  // 艦ID -> 艦情報(rarity・sortId)の対応(マス選択時の表の並び順に使用)
  const shipInfoById = useMemo(() => new Map(ships.map((s) => [s.id, s])), [ships])

  // マス選択時: そのマス(海域+マス)にドロップ実績がある新規実装・ユニーク艦の行一覧
  const selectedNodeRows = useMemo(() => {
    if (!selectedNode || !dupes) return []
    const rows: NodeDupeRow[] = []
    for (const ship of Object.values(dupes.ships)) {
      for (const e of ship.entries) {
        if (e.map === selectedNode.map && e.node === selectedNode.node) {
          const info = shipInfoById.get(ship.id)
          rows.push({
            shipId: ship.id,
            shipName: ship.name,
            rarity: info?.rarity ?? null,
            sortId: info?.sortId ?? Number.MAX_SAFE_INTEGER,
            difficulty: e.difficulty,
            rank: e.rank,
            dupes: e.dupes,
          })
        }
      }
    }
    return rows
  }, [selectedNode, dupes, shipInfoById])

  // マス選択時: そのマス(海域+マス)にドロップ実績があるレア艦の行一覧
  const selectedNodeRankRows = useMemo(() => {
    if (!selectedNode || !rankDrops) return []
    const rows: NodeRankRow[] = []
    for (const ship of Object.values(rankDrops.ships)) {
      for (const e of ship.entries) {
        if (e.map === selectedNode.map && e.node === selectedNode.node) {
          rows.push({
            shipId: ship.id,
            shipName: ship.name,
            sortId: shipInfoById.get(ship.id)?.sortId ?? Number.MAX_SAFE_INTEGER,
            difficulty: e.difficulty,
            rank: e.rank,
            drops: e.drops,
            total: e.total,
            pct: e.pct,
            dupes: e.dupes,
          })
        }
      }
    }
    return rows
  }, [selectedNode, rankDrops, shipInfoById])

  // 現在選択中の難易度の組み合わせでドロップ実績がある艦ID(非活性判定に使用)
  const availableShipIds = useMemo(() => {
    const ids = new Set<number>()
    for (const nodes of Object.values(mapNodes)) {
      for (const node of nodes) {
        for (const d of node.drops) ids.add(d.id)
      }
    }
    return ids
  }, [mapNodes])

  // 艦種グループ(rarity 1・2 のみ)。ship-type.json の定義順、同名艦種は統合
  const typeGroups = useMemo(() => {
    const knownRarity = ships.filter((s) => s.rarity === 1 || s.rarity === 2)
    const order: string[] = []
    for (const t of shipTypes) {
      if (!order.includes(t.name)) order.push(t.name)
    }
    order.push('艦種不明')
    const groups: { typeName: string; ships: Ship[] }[] = []
    for (const typeName of order) {
      const group = knownRarity
        .filter((s) => s.typeName === typeName)
        .sort(
          (a, b) => (b.rarity ?? 0) - (a.rarity ?? 0) || a.sortId - b.sortId,
        )
      if (group.length > 0) groups.push({ typeName, ships: group })
    }
    return groups
  }, [ships, shipTypes])

  // 新規実装艦はドロップする海域→マスの早い順に並べる(掘る順序に合わせる)。
  // 以降は艦の sortId 順、sortId は ships.json 未収録だと同値になるため艦IDで確定させる
  const unknownRarityShips = useMemo(
    () =>
      ships
        .filter((s) => s.rarity == null)
        .sort(
          (a, b) =>
            a.firstMapOrder - b.firstMapOrder ||
            a.firstNodeOrder - b.firstNodeOrder ||
            a.sortId - b.sortId ||
            a.id - b.id,
        ),
    [ships],
  )

  if (error) return <p className="no-data">{error}</p>
  if (!index || Object.keys(selectedDifficulties).length === 0)
    return <p className="no-data">読み込み中...</p>

  const toggleShip = (id: number) => {
    setSelectedShipId(id === selectedShipId ? null : id)
    setSelectedNode(null)
  }

  const selectNode = (mapId: string, node: string) => {
    setSelectedNode((prev) =>
      prev && prev.map === mapId && prev.node === node ? null : { map: mapId, node },
    )
    setSelectedShipId(null)
  }

  // 選択中の艦のドロップ率データ。dupes(所持数別)が優先、なければ rankDrops(マス単位)
  const selectedDupesShip =
    selectedShipId != null ? (dupes?.ships[String(selectedShipId)] ?? null) : null
  const selectedRankShip =
    selectedShipId != null ? (rankDrops?.ships[String(selectedShipId)] ?? null) : null
  const selectedShipName =
    selectedShipId != null
      ? (ships.find((s) => s.id === selectedShipId)?.name ?? null)
      : null

  const selectDifficulty = (mapId: string, difficulty: number) => {
    setSelectedDifficulties((prev) => ({ ...prev, [mapId]: difficulty }))
  }

  const selectAllDifficulties = (difficulty: number) => {
    const next: Record<string, number> = {}
    for (const mapId of Object.keys(selectedDifficulties)) {
      next[mapId] = difficulty
    }
    setSelectedDifficulties(next)
  }

  const diffValues = Object.values(selectedDifficulties)
  const allSameDifficulty = diffValues.every((d) => d === diffValues[0])
    ? diffValues[0]
    : null

  const shipButton = (s: Ship) => {
    const available = availableShipIds.has(s.id)
    return (
      <button
        key={s.id}
        className={
          `rarity-${s.rarity ?? 'u'}` +
          (s.id === selectedShipId ? ' active' : '') +
          (available ? '' : ' disabled')
        }
        disabled={!available}
        onClick={() => toggleShip(s.id)}
        title={s.nameEn}
        data-text={s.name}
      >
        {s.name}
      </button>
    )
  }

  return (
    <div className="app">
      <header>
        <h1>艦これ　ドロップ検索ツール</h1>
        <p className="description">各艦の難易度によるドロップマス、ドロップ率を表示します。</p>
      </header>

      <div className="ship-groups">
        <div className="ship-groups-head">
          <span className="ship-groups-title">艦を選択してください</span>
          <span className="ship-legend">
            枠色:{' '}
            <span className="legend new-ship">新規実装</span>{' '}
            <span className="legend rarity-2">ユニーク</span>{' '}
            <span className="legend rarity-1">レア</span>
          </span>
        </div>
        {unknownRarityShips.length > 0 && (
          <div className="ship-group new-ships">
            <span className="group-label">新規実装</span>
            <div className="ship-group-buttons">
              {unknownRarityShips.map(shipButton)}
            </div>
          </div>
        )}
        {typeGroups.map((g) => (
          <div key={g.typeName} className="ship-group">
            <span className="group-label">{g.typeName}</span>
            <div className="ship-group-buttons">{g.ships.map(shipButton)}</div>
          </div>
        ))}
      </div>

      <div className="board">
        <MapGrid
          mapLabels={mapLabels}
          mapAllNodes={mapAllNodes}
          mapNodes={mapNodes}
          difficulties={index.difficulties}
          selectedDifficulties={selectedDifficulties}
          onSelectDifficulty={selectDifficulty}
          selectedShipId={selectedShipId}
          selectedShipName={selectedShipName}
          allSameDifficulty={allSameDifficulty}
          onSelectAllDifficulties={selectAllDifficulties}
          selectedNode={selectedNode}
          onSelectNode={selectNode}
        />

        {selectedNode ? (
          <div className="node-tables">
            <NodeDupesTable
              mapId={selectedNode.map}
              node={selectedNode.node}
              difficultyName={mapDiffName[selectedNode.map] ?? ''}
              mapLabels={mapLabels}
              rows={selectedNodeRows}
              onSelectShip={toggleShip}
            />
            <NodeRankDropsTable
              mapId={selectedNode.map}
              node={selectedNode.node}
              difficultyName={mapDiffName[selectedNode.map] ?? ''}
              mapLabels={mapLabels}
              rows={selectedNodeRankRows}
              onSelectShip={toggleShip}
            />
          </div>
        ) : selectedDupesShip ? (
          <DupesTable
            ship={selectedDupesShip}
            selectedShipName={selectedShipName}
            mapLabels={mapLabels}
            mapOrder={mapOrder}
            mapDiffName={mapDiffName}
            showAll={showAllRates}
            onToggleShowAll={() => setShowAllRates((v) => !v)}
            onSelectNode={selectNode}
          />
        ) : selectedRankShip ? (
          <RankDropsTable
            ship={selectedRankShip}
            selectedShipName={selectedShipName}
            mapLabels={mapLabels}
            mapOrder={mapOrder}
            mapDiffName={mapDiffName}
            showAll={showAllRates}
            onToggleShowAll={() => setShowAllRates((v) => !v)}
            onSelectNode={selectNode}
          />
        ) : (
          <DupesTable
            ship={null}
            selectedShipName={selectedShipName}
            mapLabels={mapLabels}
            mapOrder={mapOrder}
            mapDiffName={mapDiffName}
            showAll={showAllRates}
            onToggleShowAll={() => setShowAllRates((v) => !v)}
            onSelectNode={selectNode}
          />
        )}
      </div>

      <footer className="footer">
        <div>
          データ取得: {new Date(index.updated).toLocaleDateString('ja-JP')} /
          出典:{' '}
          <a href="https://tsunkit.net/nav/" target="_blank" rel="noreferrer">
            KCNav (TsunKit)
          </a>
          <br />
          ご意見ご要望はこちらに：
          <a
            href="https://marshmallow-qa.com/lmingitwavpu1ou?t=OFjHMa&utm_medium=url_text&utm_source=promotion"
            target="_blank"
            rel="noreferrer"
          >
            マシュマロ（匿名メッセージ）
          </a>
        </div>
        <div className="footer-meta">
          <a
            href="https://github.com/iora339/kc-drop-srch"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <span className="footer-version">{APP_VERSION}</span>
        </div>
      </footer>
    </div>
  )
}

export default App
