export interface DropEntry {
  id: number
  name: string
  nameEn: string
  drops: number
  total: number
  pct: number | null
  rarity: number | null
  ranks: { s: boolean; a: boolean; b: boolean }
}

export interface NodeData {
  node: string
  typeId: number
  boss: boolean
  edges: string[]
  samples: number
  drops: DropEntry[]
}

export interface DifficultyData {
  name: string
  nodes: NodeData[]
}

/**
 * 海域の種別。event は難易度(甲乙丙丁)を持ち、マスグリッドを描く。
 * normal は難易度の概念がなく、所持数別ドロップ率だけを扱う。
 */
export type MapKind = 'event' | 'normal'

export interface MapData {
  map: string
  kind?: MapKind
  ranks: string
  difficulties: Record<string, DifficultyData>
}

export interface MasterShip {
  id: number
  name: string
  shipType: number
  afterId: number | null
  sortId: number
}

export interface ShipType {
  id: number
  name: string
  code: string
}

export interface DifficultyOption {
  id: number
  name: string
}

/** 種別ごとの表示名と難易度セット。難易度が1つだけの種別では難易度UIを出さない。 */
export interface KindData {
  id: MapKind
  label: string
  difficulties: DifficultyOption[]
}

export interface MapEntry {
  id: string
  kind?: MapKind
  /** 表示名。event は E1/E2…、normal は海域IDそのもの */
  label?: string
}

export interface IndexData {
  updated: string
  /** 集計期間の開始日(YYYY-MM-DD)。これより前の実績は含まない */
  start?: string
  difficulties: DifficultyOption[]
  ranks: string
  kinds?: KindData[]
  maps: MapEntry[]
}

export interface DupeSample {
  owned: number
  drops: number
  total: number
  pct: number | null
}

/**
 * 所持数別ドロップ率の1行。dupes は所持 0/1/2隻 と owned=3(「3隻以上」の合算)の4要素。
 * 元データが 2隻ちょうどまでしか持たないため、3隻以上は合計との差で求めている。
 */
export interface DupeEntry {
  map: string
  difficulty: string
  node: string
  rank: string
  dupes: DupeSample[]
}

export interface ShipDupes {
  id: number
  name: string
  nameEn: string | null
  rarity: number | null
  entries: DupeEntry[]
}

export interface DupesData {
  updated: string
  ships: Record<string, ShipDupes>
}
