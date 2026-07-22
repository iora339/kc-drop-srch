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

export interface MapData {
  map: string
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

export interface IndexData {
  updated: string
  difficulties: { id: number; name: string }[]
  ranks: string
  maps: { id: string }[]
}

export interface DupeSample {
  owned: number
  drops: number
  total: number
  pct: number | null
}

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
  start: string | null
  entries: DupeEntry[]
}

export interface DupesData {
  updated: string
  ships: Record<string, ShipDupes>
}

export interface RankDropEntry {
  map: string
  difficulty: string
  node: string
  rank: string
  drops: number
  total: number
  pct: number | null
  dupes: number | null
}

export interface ShipRankDrops {
  id: number
  name: string
  entries: RankDropEntry[]
}

export interface RankDropsData {
  updated: string
  ships: Record<string, ShipRankDrops>
}
