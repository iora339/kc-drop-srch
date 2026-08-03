import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  DifficultyOption,
  DropEntry,
  DupeEntry,
  DupeSample,
  DupesData,
  IndexData,
  MapData,
  MapKind,
  MasterShip,
  NodeData,
  ShipDupes,
  ShipType,
} from './types'
import './App.css'

const DATA_BASE = `${import.meta.env.BASE_URL}data/`
const DIFF_STORAGE_KEY = 'kc-drop-srch:selectedDifficulties'

// 海域の種別ごとの所持数別ドロップ率。イベントは初回に読み、
// 通常はタブを開いたときに読む(件数が多く容量が大きいため)
const DUPES_FILE: Record<MapKind, string> = {
  event: 'dupes.json',
  normal: 'dupes-normal.json',
}

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

// 難易度の表示順。通常海域は難易度を持たないため末尾に置く(タブ内では
// 全行が同じ値になるので順序に影響しないが、indexOf が -1 になるのを避ける)
const DIFF_ORDER = ['甲', '乙', '丙', '丁', '通常']
const RANK_ORDER = ['S', 'A', 'B']
// 所持数の内訳。元データが持つのは 0/1/2隻ちょうどまでで、
// それ以上は合計との差から求めるため最終バケットは「3隻以上」になる
const OWNED_BUCKETS = [0, 1, 2]
const OWNED_PLUS = 3

const DUPES_CAVEAT =
  '「-」はドロップ実績なし。母数が小さい箇所は確率がブレやすい点に注意してください。'

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
// plus=true のとき owned>=count を合算(3隻以上用)。
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

// 所持数 0〜2隻 + 3隻以上のドロップ率セル一式(DupesTable/NodeDupesTable で共用)
function OwnedBucketCells({ dupes }: { dupes: DupeSample[] }) {
  const plus = bucketPct(dupes, OWNED_PLUS, true)
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

// 所持数バケット列のヘッダー(n隻/3隻以上のソートボタン行)。
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
        {OWNED_PLUS}隻以上{sortIndicator('plus')}
      </th>
    </tr>
  )
}

// 難易度・海域・マス・勝利ランクの並び替え可能ヘッダー。
// showDifficulty=false のとき難易度列を出さない(通常海域は難易度を持たないため)
function EntryHeaderCells({
  rowSpan,
  showDifficulty = true,
  toggleSort,
  sortIndicator,
}: {
  rowSpan?: number
  showDifficulty?: boolean
  toggleSort: (key: 'difficulty' | 'map' | 'node' | 'rank', dir: SortDir) => void
  sortIndicator: (key: 'difficulty' | 'map' | 'node' | 'rank') => ReactNode
}) {
  return (
    <>
      {showDifficulty && (
        <th
          rowSpan={rowSpan}
          className="dupes-sortable dupes-col-narrow"
          onClick={() => toggleSort('difficulty', 'asc')}
        >
          難易度{sortIndicator('difficulty')}
        </th>
      )}
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

// 難易度・海域・マス・勝利ランクの表示セル。列構成は EntryHeaderCells と揃える
function EntryBodyCells({
  entry,
  mapLabels,
  showDifficulty = true,
  clickableNode = true,
  onSelectNode,
}: {
  entry: { map: string; difficulty: string; node: string; rank: string }
  mapLabels: Record<string, string>
  showDifficulty?: boolean
  clickableNode?: boolean
  onSelectNode: (mapId: string, node: string) => void
}) {
  return (
    <>
      {showDifficulty && <td className="dupes-col-narrow">{entry.difficulty}</td>}
      <td className="dupes-col-narrow">{mapLabels[entry.map] ?? entry.map}</td>
      <td
        className={'dupes-col-narrow' + (clickableNode ? ' dupes-clickable' : '')}
        onClick={clickableNode ? () => onSelectNode(entry.map, entry.node) : undefined}
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

// 所持数バケットのソートキー(隻数 or 'plus')比較。DupesTable/NodeDupesTable で共用。
const compareBucket = (a: DupeSample[], b: DupeSample[], key: number | 'plus'): number =>
  key === 'plus'
    ? bucketPct(a, OWNED_PLUS, true).value - bucketPct(b, OWNED_PLUS, true).value
    : bucketPct(a, key).value - bucketPct(b, key).value

// 選択中の難易度の行のみ表示(全難度モード時は絞らない)。
function filterByDifficulty<T extends { map: string; difficulty: string }>(
  entries: T[],
  showAll: boolean,
  mapDiffName: Record<string, string>,
): T[] {
  return entries.filter((e) => showAll || mapDiffName[e.map] === e.difficulty)
}

// マス選択表向け: 難度を確定させた上でランクフィルタを適用。
function filterNodeRows<T extends { difficulty: string; rank: string }>(
  rows: T[],
  difficultyName: string,
  rankFilter: Set<string>,
): T[] {
  return rows
    .filter((r) => r.difficulty === difficultyName)
    .filter((r) => rankFilter.size === 0 || rankFilter.has(r.rank))
}

// クリックソート未指定時は既定順、指定時はキー比較→既定順でタイブレーク。両テーブル共通のソート適用処理。
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

// 艦選択時: 難易度・海域・マス・勝利 + 所持数4列。
// 難易度列を出さない場合は左側の幅をその分だけ広げ、所持数の列位置を変えない
// (タブや選択を切り替えても数値列が横にずれないようにするため)
function DupesColGroup({ showDifficulty = true }: { showDifficulty?: boolean }) {
  return (
    <colgroup>
      {showDifficulty && <col className="dupes-col-diff" />}
      <col className="dupes-col-map" />
      <col className="dupes-col-node" />
      <col className="dupes-col-rank" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket-plus" />
    </colgroup>
  )
}

// マス選択時: 艦名・勝利 + 所持数4列
function NodeDupesColGroup() {
  return (
    <colgroup>
      <col className="dupes-col-ship" />
      <col className="dupes-col-rank" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket" />
      <col className="dupes-col-bucket-plus" />
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
  hasDifficulty = true,
  emptyMessage,
  onToggleShowAll,
  onSelectNode,
}: {
  ship: ShipDupes | null
  selectedShipName: string | null
  mapLabels: Record<string, string>
  mapOrder: (mapId: string) => number
  mapDiffName: Record<string, string>
  showAll: boolean
  /** 難易度を持つ海域か。false なら難易度列・難易度の絞り込み・マス遷移を出さない */
  hasDifficulty?: boolean
  emptyMessage?: string
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

  const entries = ship
    ? hasDifficulty
      ? filterByDifficulty(ship.entries, showAll, mapDiffName)
      : ship.entries
    : []
  const rows = sortWithFallback(entries, sort, compareByKey, (a, b) =>
    compareEntryDefault(a, b, mapOrder),
  )
  return (
    <div className="dupes card">
      <div className="dupes-head">
        <div className="dupes-title">
          {selectedShipName && (
            <span className="title-ship">{selectedShipName}</span>
          )}
          所持数別のドロップ率
        </div>
        {hasDifficulty && (
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
            全難易度のドロップ率を表示
          </button>
        )}
      </div>
      {ship ? (
        <>
          <ScrollTable className="dupes-table-fixed">
            <DupesColGroup showDifficulty={hasDifficulty} />
            <thead>
              <tr>
                <EntryHeaderCells
                  rowSpan={2}
                  showDifficulty={hasDifficulty}
                  toggleSort={toggleSort}
                  sortIndicator={sortIndicator}
                />
                <th colSpan={4} className="dupes-owned-head">
                  所持数
                </th>
              </tr>
              <OwnedBucketHeaderCells toggleSort={toggleSort} sortIndicator={sortIndicator} />
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={i}>
                  <EntryBodyCells
                    entry={e}
                    mapLabels={mapLabels}
                    showDifficulty={hasDifficulty}
                    clickableNode={hasDifficulty}
                    onSelectNode={onSelectNode}
                  />
                  <OwnedBucketCells dupes={e.dupes} />
                </tr>
              ))}
            </tbody>
          </ScrollTable>
          <p className="dupes-note">
            選択した艦の各海域でのドロップ率を表示しています。
            {DUPES_CAVEAT}
            所持数3隻以上は所持数制限がある可能性があります。必要に応じてKCNavで確認してください。
          </p>
        </>
      ) : (
        <p className="dupes-empty">
          {selectedShipName
            ? `${selectedShipName}の所持数別のドロップ率データはありません。`
            : (emptyMessage ??
              '艦または各海域のマスを選択すると、所持数別のドロップ率を表示します。')}
        </p>
      )}
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

// マス視点: 選択中マス(海域+難度+マス)にドロップ実績のある艦を一覧表示。
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
          所持数別のドロップ率
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
                <th colSpan={4} className="dupes-owned-head">
                  所持数
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
            選択したマスでドロップ実績がある艦を表示しています。
            {DUPES_CAVEAT}
            所持数3隻以上は所持数制限がある可能性があります。必要に応じてKCNavで確認してください。
          </p>
        </>
      ) : (
        <p className="dupes-empty">このマスにはドロップ実績がありません。</p>
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
        海域・マス別のドロップ状況
      </div>
      <nav className="difficulty-all">
        <span className="difficulty-all-label">全海域一括：</span>
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

/** 種別ごとの難易度セット。kinds が無い古いデータでは全体の difficulties を使う */
function kindDifficulties(idx: IndexData): Partial<Record<MapKind, DifficultyOption[]>> {
  if (!idx.kinds?.length) return { event: idx.difficulties }
  return Object.fromEntries(idx.kinds.map((k) => [k.id, k.difficulties]))
}

/** 海域が1つ以上ある種別。0件の種別はタブに出さない(イベント期間外など) */
function kindsWithMaps(idx: IndexData): MapKind[] {
  const order: MapKind[] = idx.kinds?.length
    ? idx.kinds.map((k) => k.id)
    : ['event', 'normal']
  const has = new Set(idx.maps.map((m) => m.kind ?? 'event'))
  return order.filter((k) => has.has(k))
}

function App() {
  const [index, setIndex] = useState<IndexData | null>(null)
  const [maps, setMaps] = useState<Record<string, MapData>>({})
  const [masterShips, setMasterShips] = useState<MasterShip[]>([])
  const [shipTypes, setShipTypes] = useState<ShipType[]>([])
  const [dupesByKind, setDupesByKind] = useState<
    Partial<Record<MapKind, DupesData | null>>
  >({})
  // 常にイベント海域を優先して開く(イベントが無ければ通常海域へ倒す)
  const [tab, setTab] = useState<MapKind>('event')
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
        const [idx, master, types, dupesData] = await Promise.all([
          fetch(`${DATA_BASE}index.json`).then((r) => r.json() as Promise<IndexData>),
          fetch(`${DATA_BASE}ships.json`).then((r) => r.json() as Promise<MasterShip[]>),
          fetch(`${DATA_BASE}ship-type.json`).then((r) => r.json() as Promise<ShipType[]>),
          fetch(`${DATA_BASE}${DUPES_FILE.event}`)
            .then((r) => (r.ok ? (r.json() as Promise<DupesData>) : null))
            .catch(() => null),
        ])
        setIndex(idx)
        setMasterShips(master)
        setShipTypes(types)
        setDupesByKind({ event: dupesData })

        // 難易度の初期値。種別ごとの難易度セットから最も高いものを既定にし、
        // 保存済みの選択があれば復元する(通常海域は難易度が1つなのでそれを入れる)
        const kindDiffs = kindDifficulties(idx)
        const saved = loadSavedDifficulties()
        const initialDiffs: Record<string, number> = {}
        idx.maps.forEach((m) => {
          const options = kindDiffs[m.kind ?? 'event'] ?? idx.difficulties
          const valid = new Set(options.map((d) => d.id))
          const max = options.reduce((a, d) => (d.id > a ? d.id : a), options[0]?.id ?? 4)
          const savedDiff = saved[m.id]
          initialDiffs[m.id] =
            savedDiff != null && valid.has(savedDiff) ? savedDiff : max
        })
        setSelectedDifficulties(initialDiffs)

        // 開くタブは常にイベント海域が第一候補。イベント期間外で海域が無ければ
        // 存在する種別(通常海域)へ倒す
        const available = kindsWithMaps(idx)
        setTab(available.includes('event') ? 'event' : (available[0] ?? 'event'))

        // マスグリッドを描くのはイベント海域だけなので、読むのもその分だけ
        const gridMaps = idx.maps.filter((m) => (m.kind ?? 'event') === 'event')
        const mapEntries = await Promise.all(
          gridMaps.map(
            async (m) =>
              [m.id, await fetch(`${DATA_BASE}${m.id}.json`).then((r) => r.json())] as const,
          ),
        )
        setMaps(Object.fromEntries(mapEntries))
      } catch {
        setError('データの読み込みに失敗しました。')
      }
    })()
  }, [])

  // 通常海域のドロップ率はタブを開いたときに読む(初回表示を軽くするため)
  useEffect(() => {
    if (tab === 'event' || dupesByKind[tab] !== undefined) return
    let cancelled = false
    ;(async () => {
      const data = await fetch(`${DATA_BASE}${DUPES_FILE[tab]}`)
        .then((r) => (r.ok ? (r.json() as Promise<DupesData>) : null))
        .catch(() => null)
      if (!cancelled) setDupesByKind((prev) => ({ ...prev, [tab]: data }))
    })()
    return () => {
      cancelled = true
    }
  }, [tab, dupesByKind])

  // 難易度選択を localStorage に保存し、再読み込み後も引き継ぐ
  useEffect(() => {
    if (Object.keys(selectedDifficulties).length === 0) return
    localStorage.setItem(DIFF_STORAGE_KEY, JSON.stringify(selectedDifficulties))
  }, [selectedDifficulties])

  // 表示中のタブに属する海域(以降の集計はすべてこの範囲で行う)
  const tabMaps = useMemo(
    () => (index?.maps ?? []).filter((m) => (m.kind ?? 'event') === tab),
    [index, tab],
  )

  // タブに出す種別。海域が0件の種別は出さない(イベント期間外など)
  const availableKinds = useMemo(() => {
    if (!index) return []
    const labels = new Map(index.kinds?.map((k) => [k.id, k.label]) ?? [])
    return kindsWithMaps(index).map((id) => ({
      id,
      label: labels.get(id) ?? (id === 'event' ? 'イベント海域' : '通常海域'),
    }))
  }, [index])

  // 表示中のタブの難易度セット。1つ以下なら難易度UIを出さない
  const tabDifficulties = useMemo(
    () => (index ? (kindDifficulties(index)[tab] ?? index.difficulties) : []),
    [index, tab],
  )

  // 海域ID -> 表示名。生成側が確定させた label をそのまま使う
  const mapLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    index?.maps.forEach((m) => {
      labels[m.id] = m.label ?? m.id
    })
    return labels
  }, [index])

  // 海域IDの並び順(dupes 表の海域ソート用)。タブ内の並びで判定する
  const mapOrder = useMemo(() => {
    const idx = new Map(tabMaps.map((m, i) => [m.id, i]))
    return (mapId: string) => idx.get(mapId) ?? Number.MAX_SAFE_INTEGER
  }, [tabMaps])

  // 海域ID -> 選択中の難易度名(dupes 表のフィルタ用)
  // 種別をまたいで引けるよう、難易度IDの対応は kinds 全体から作る
  const mapDiffName = useMemo(() => {
    const byId = new Map(index?.difficulties.map((d) => [d.id, d.name]))
    for (const k of index?.kinds ?? []) {
      for (const d of k.difficulties) byId.set(d.id, d.name)
    }
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

  // 艦種名の解決(装甲空母→正規空母 などの統合を含む)。艦リスト生成で共用する
  const typeNameOf = useMemo(() => {
    const masterById = new Map(masterShips.map((m) => [m.id, m]))
    const typeNameMerge: Record<string, string> = {
      装甲空母: '正規空母',
      潜水空母: '潜水艦',
    }
    const typeNameById = new Map(
      shipTypes.map((t) => [t.id, typeNameMerge[t.name] ?? t.name]),
    )
    return (shipId: number) => {
      const master = masterById.get(shipId)
      return {
        typeName: master ? typeNameById.get(master.shipType) ?? '艦種不明' : '艦種不明',
        sortId: master?.sortId ?? Number.MAX_SAFE_INTEGER,
      }
    }
  }, [masterShips, shipTypes])

  // 表示中のタブに出す艦一覧(rarity 1 / 2 / null、艦種名を付与)。
  // イベントタブはマスグリッドのデータから、通常タブはドロップ率データから組む
  // (通常海域はグリッドを持たないため)。難易度を切り替えてもボタン構成は変わらない。
  const ships = useMemo(() => {
    const byId = new Map<number, Ship>()
    if (tab === 'event') {
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
              if (d.rarity !== 1 && d.rarity !== 2 && d.rarity != null) continue
              const cur = byId.get(d.id)
              if (cur) {
                if (
                  order < cur.firstMapOrder ||
                  (order === cur.firstMapOrder && nodeOrder < cur.firstNodeOrder)
                ) {
                  cur.firstMapOrder = order
                  cur.firstNodeOrder = nodeOrder
                }
              } else {
                byId.set(d.id, {
                  id: d.id,
                  name: d.name,
                  nameEn: d.nameEn,
                  rarity: d.rarity,
                  ...typeNameOf(d.id),
                  firstMapOrder: order,
                  firstNodeOrder: nodeOrder,
                })
              }
            }
          }
        }
      }
    } else {
      for (const ship of Object.values(dupesByKind[tab]?.ships ?? {})) {
        const order = ship.entries.reduce(
          (min, e) => Math.min(min, mapOrder(e.map)),
          Number.MAX_SAFE_INTEGER,
        )
        byId.set(ship.id, {
          id: ship.id,
          name: ship.name,
          nameEn: ship.nameEn ?? ship.name,
          rarity: ship.rarity,
          ...typeNameOf(ship.id),
          firstMapOrder: order,
          firstNodeOrder: 0, // グリッドが無いのでマスの早さは使わない
        })
      }
    }
    return [...byId.values()]
  }, [tab, maps, dupesByKind, mapOrder, mapAllNodes, typeNameOf])

  // 艦ID -> 艦情報(rarity・sortId)の対応(マス選択時の表の並び順に使用)
  const shipInfoById = useMemo(() => new Map(ships.map((s) => [s.id, s])), [ships])

  // 表示中のタブのドロップ率データ
  const dupes = dupesByKind[tab] ?? null

  // 通常海域はメンテ以降の実績に限定しているため、集計期間を見出しの横に出す
  // (イベント海域は期間＝イベント期間なので出さない)
  const periodLabel = useMemo(() => {
    if (tab !== 'normal' || !index?.start) return null
    const d = new Date(index.start)
    if (Number.isNaN(d.getTime())) return null
    return `集計：${d.toLocaleDateString('ja-JP')}～`
  }, [tab, index])

  // マス選択時: そのマス(海域+マス)にドロップ実績がある艦の行一覧
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

  // ドロップ実績がある艦ID(非活性判定に使用)。イベントタブは選択中の難易度の
  // 組み合わせで判定する。通常タブは難易度が無いので、データを持つ艦がそのまま対象
  const availableShipIds = useMemo(() => {
    const ids = new Set<number>()
    if (tab === 'event') {
      for (const nodes of Object.values(mapNodes)) {
        for (const node of nodes) {
          for (const d of node.drops) ids.add(d.id)
        }
      }
    } else {
      for (const ship of Object.values(dupes?.ships ?? {})) {
        if (ship.entries.length > 0) ids.add(ship.id)
      }
    }
    return ids
  }, [tab, mapNodes, dupes])

  // 艦種グループ(新規実装艦を除く)。ship-type.json の定義順、同名艦種は統合。
  // レア度(1=レア/2=ユニーク)は表示上の区別がないため、並び順も艦これ本来の sortId のみ
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
        .sort((a, b) => a.sortId - b.sortId || a.id - b.id)
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
  // index が来れば難易度の初期値も同時に入る(同じ useEffect で set しているため)。
  // 海域が0件でも表示は進める
  if (!index) return <p className="no-data">読み込み中…</p>

  // 表示中のタブのドロップ率データがまだ来ていない(通常海域は遅延ロード)
  const tabLoading = dupesByKind[tab] === undefined

  const toggleShip = (id: number) => {
    setSelectedShipId(id === selectedShipId ? null : id)
    setSelectedNode(null)
  }

  // タブを切り替えると対象の海域・艦が入れ替わるため、選択はいったん解除する
  const selectTab = (kind: MapKind) => {
    if (kind === tab) return
    setTab(kind)
    setSelectedShipId(null)
    setSelectedNode(null)
  }

  const selectNode = (mapId: string, node: string) => {
    setSelectedNode((prev) =>
      prev && prev.map === mapId && prev.node === node ? null : { map: mapId, node },
    )
    setSelectedShipId(null)
  }

  // 選択中の艦のドロップ率データ(所持数別)
  const selectedDupesShip =
    selectedShipId != null ? (dupes?.ships[String(selectedShipId)] ?? null) : null
  const selectedShipName =
    selectedShipId != null
      ? (ships.find((s) => s.id === selectedShipId)?.name ?? null)
      : null

  const selectDifficulty = (mapId: string, difficulty: number) => {
    setSelectedDifficulties((prev) => ({ ...prev, [mapId]: difficulty }))
  }

  // 一括切替も一括判定も、対象は表示中のタブの海域だけにする
  // (他タブの海域まで見ると選択表示が常に不一致になる)
  const selectAllDifficulties = (difficulty: number) => {
    setSelectedDifficulties((prev) => {
      const next = { ...prev }
      for (const m of tabMaps) next[m.id] = difficulty
      return next
    })
  }

  const diffValues = tabMaps.map((m) => selectedDifficulties[m.id])
  const allSameDifficulty =
    diffValues.length > 0 && diffValues.every((d) => d === diffValues[0])
      ? diffValues[0]
      : null

  const shipButton = (s: Ship) => {
    const available = availableShipIds.has(s.id)
    return (
      <button
        key={s.id}
        className={
          (s.id === selectedShipId ? 'active' : '') +
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
        {/* マス単位の表示はイベント海域だけなので、イベントが無い期間は触れない */}
        <p className="description">
          {availableKinds.some((k) => k.id === 'event')
            ? '艦ごと・マスごとのドロップ率を表示します。'
            : '艦ごとのドロップ率を表示します。'}
        </p>
      </header>

      {availableKinds.length > 1 && (
        <nav className="kind-tabs">
          {availableKinds.map((k) => (
            <button
              key={k.id}
              className={k.id === tab ? 'active' : ''}
              aria-pressed={k.id === tab}
              onClick={() => selectTab(k.id)}
            >
              {k.label}
            </button>
          ))}
        </nav>
      )}

      <div className={'ship-groups' + (availableKinds.length > 1 ? ' has-tabs' : '')}>
        <div className="ship-groups-head">
          <span className="ship-groups-title">
            {tab === 'event'
              ? '艦または各海域のマスを選択してください'
              : '艦を選択してください'}
            {periodLabel && (
              <span className="ship-groups-period">{periodLabel}</span>
            )}
          </span>
          {/* 強調するのは新規実装艦だけなので、該当が無ければ凡例ごと出さない */}
          {unknownRarityShips.length > 0 && (
            <span className="ship-legend">
              枠色：<span className="legend new-ship">新規実装</span>
            </span>
          )}
        </div>
        {tabLoading && ships.length === 0 && (
          <p className="ship-groups-empty">読み込み中…</p>
        )}
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
        {/* マスグリッドを描くのはイベント海域だけ(通常海域はマス単位の表を持たない) */}
        {tab === 'event' && (
          <MapGrid
            mapLabels={mapLabels}
            mapAllNodes={mapAllNodes}
            mapNodes={mapNodes}
            difficulties={tabDifficulties}
            selectedDifficulties={selectedDifficulties}
            onSelectDifficulty={selectDifficulty}
            selectedShipId={selectedShipId}
            selectedShipName={selectedShipName}
            allSameDifficulty={allSameDifficulty}
            onSelectAllDifficulties={selectAllDifficulties}
            selectedNode={selectedNode}
            onSelectNode={selectNode}
          />
        )}

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
          </div>
        ) : (
          <DupesTable
            ship={selectedDupesShip}
            selectedShipName={selectedShipName}
            mapLabels={mapLabels}
            mapOrder={mapOrder}
            mapDiffName={mapDiffName}
            showAll={showAllRates}
            hasDifficulty={tabDifficulties.length > 1}
            emptyMessage={
              tab === 'event'
                ? undefined
                : '艦を選択すると、所持数別のドロップ率を表示します。'
            }
            onToggleShowAll={() => setShowAllRates((v) => !v)}
            onSelectNode={selectNode}
          />
        )}
      </div>

      <footer className="footer">
        <div>
          データ取得：{new Date(index.updated).toLocaleDateString('ja-JP')} /
          出典：
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
