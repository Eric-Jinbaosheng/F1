import type { TeamId } from '../utils/storage'
import type { Difficulty } from './opponents'

export const enum GameState {
  BOOT = 'boot',
  MENU = 'menu',
  SCAN = 'scan',
  PICK_TEAM = 'pickTeam',
  COUNTDOWN = 'countdown',
  RACE = 'race',
  CRASH = 'crash',
  FINISH = 'finish',
  RESULT = 'result',
}

export interface PlayerData {
  faceImg: HTMLCanvasElement | null
  nickname: string
  team: TeamId | null
}

export interface RaceData {
  startTime: number
  currentLap: number
  bestLap: number | null
  s1: number
  s2: number
  s3: number
  topSpeed: number
  crashes: number
  /** Body-on-body bumps with AI cars (debounced). */
  opponentHits: number
  /** Final position 1..4 once race ends; 0 while in progress. */
  finalPosition: number
}

export type InputMode = 'gyro' | 'touch' | 'keyboard' | 'unknown'

export interface GameContext {
  state: GameState
  playerData: PlayerData
  raceData: RaceData
  inputMode: InputMode
  difficulty: Difficulty
}

export interface StateNode {
  enter?: (ctx: GameContext) => void | Promise<void>
  exit?: (ctx: GameContext) => void | Promise<void>
  update?: (ctx: GameContext, dt: number) => void
}

export const createInitialContext = (): GameContext => ({
  state: GameState.BOOT,
  playerData: {
    faceImg: null,
    nickname: '',
    team: null,
  },
  raceData: {
    startTime: 0,
    currentLap: 0,
    bestLap: null,
    s1: 0,
    s2: 0,
    s3: 0,
    topSpeed: 0,
    crashes: 0,
    opponentHits: 0,
    finalPosition: 0,
  },
  inputMode: 'unknown',
  difficulty: 'medium',
})

const VALID_TRANSITIONS: Record<GameState, GameState[]> = {
  [GameState.BOOT]: [GameState.MENU],
  [GameState.MENU]: [GameState.SCAN],
  [GameState.SCAN]: [GameState.PICK_TEAM, GameState.MENU],
  [GameState.PICK_TEAM]: [GameState.COUNTDOWN, GameState.MENU],
  [GameState.COUNTDOWN]: [GameState.RACE, GameState.COUNTDOWN, GameState.MENU],
  [GameState.RACE]: [GameState.CRASH, GameState.FINISH, GameState.MENU],
  [GameState.CRASH]: [GameState.RACE, GameState.MENU],
  [GameState.FINISH]: [GameState.RESULT],
  [GameState.RESULT]: [GameState.COUNTDOWN, GameState.MENU],
}

export class StateMachine {
  private readonly ctx: GameContext
  private readonly nodes: Map<GameState, StateNode> = new Map()

  constructor(ctx: GameContext) {
    this.ctx = ctx
  }

  register(state: GameState, node: StateNode): void {
    this.nodes.set(state, node)
  }

  context(): GameContext {
    return this.ctx
  }

  async transition(to: GameState): Promise<void> {
    const from = this.ctx.state
    const allowed = VALID_TRANSITIONS[from] ?? []
    if (!allowed.includes(to)) {
      console.warn(`[F1S] invalid transition: ${from} -> ${to}`)
      return
    }
    try {
      const oldNode = this.nodes.get(from)
      if (oldNode?.exit) await oldNode.exit(this.ctx)
    } catch (e) {
      console.warn(`[F1S] exit ${from} failed:`, e)
    }
    this.ctx.state = to
    try {
      const newNode = this.nodes.get(to)
      if (newNode?.enter) await newNode.enter(this.ctx)
    } catch (e) {
      console.warn(`[F1S] enter ${to} failed:`, e)
    }
  }

  update(dt: number): void {
    const node = this.nodes.get(this.ctx.state)
    if (!node?.update) return
    try {
      node.update(this.ctx, dt)
    } catch (e) {
      console.warn(`[F1S] update ${this.ctx.state} failed:`, e)
    }
  }
}
