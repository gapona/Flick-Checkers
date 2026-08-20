/**
 * A plain lookup-table i18n layer, not a library — `t(key, params?)` does `{name}` substitution
 * only; no plurals, no ICU MessageFormat, no locale-aware number/date formatting. Reach for a
 * real i18n library instead if a game ever needs those.
 *
 * `es` is typed as `Record<StringKey, string>` (`StringKey` derived FROM `en`'s own keys, not
 * hand-duplicated) — TypeScript's excess-property + missing-property checks on that assignment
 * mean `es` must have exactly the same key set as `en`, at compile time. A locale dictionary
 * silently drifting out of sync with the canonical `en` one (a key added to one but not the
 * other) is exactly the kind of bug that's invisible until a specific UI element renders
 * blank/wrong in one language — this makes it a build error instead. Extend both objects
 * together, in the same commit.
 */
import { getLanguage } from '../platform/yt'

export type Locale = 'en' | 'es'
export const DEFAULT_LOCALE: Locale = 'en'
const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'es']

const en = {
  settings: 'Settings',
  sound: 'Sound',
  music: 'Music',
  close: 'Close',
  back: 'Back',
  on: 'ON',
  off: 'OFF',
  shop: 'Shop',
  buy: 'Buy',
  owned: 'Owned',
  backToMatch: 'Back to match',
  shopBoards: 'Boards',
  shopPieces: 'Discs',
  shopTopup: '\u{1F3AC} +{n} coins',

  // -- menu -----------------------------------------------------------------------------------
  gameTitle: 'Flick Checkers',
  continueMatch: 'Continue',
  newGame: 'New game',
  modes: 'Modes',
  // Bottom-navigation labels. Short by requirement, not by accident: a tab label is a third of
  // the screen wide minus its own padding, and a long one has nowhere to go.
  navHome: 'Home',
  cancel: 'Cancel',
  leaveMatch: 'Leave',
  leaveMatchAsk: 'Leave this match? Your progress is saved — you can continue from the menu.',
  // §6's promise, said on the screen where a player would otherwise suspect otherwise.
  // §6's promise, said out loud on the screen where a player would otherwise suspect otherwise —
  // and it matters MORE now than it did under Easy/Medium/Hard, because a character with a face and
  // a voice is a character it is easier to believe is cheating.
  opponentNote: 'Each opponent differs in how many shots it considers, how steady its aim is, and what it plays for — never in the rules it plays by.',

  // -- rule sets (CHAPAEV-PLAN.md §3). `ruleName*` is the set's name; `ruleAbout*` says how it
  // differs from the DEFAULT one (classic), which is the one thing a player choosing between them
  // actually needs.
  ruleNameClassic: 'Classic',
  ruleNameBumper: 'Bumpers',
  ruleNameBlitz: 'Blitz',
  ruleNamePits: 'Pits',
  // Every mode is won the same way — clear the other side — so the line that actually helps is HOW
  // a disc leaves in this mode, and what it costs you. `ruleWin*` says the first, `ruleAbout*` the
  // second. Both are shown on the card.
  ruleWinDefault: 'Win: knock every enemy disc off the board.',
  ruleWinBumper: 'Win: drop every enemy disc into a hole — the walls bounce, so nothing falls off the edge.',
  ruleWinPits: 'Win: knock every enemy disc off the board, or into one of the holes.',
  ruleAboutClassic: 'The turn always passes. Lose one of your own and the other side shoots twice.',
  ruleAboutBumper: 'The rim bounces instead of swallowing, so a wall is a shot you can bank off — and the four holes become the only way anything leaves.',
  ruleAboutBlitz: 'Five seconds a shot. No time to line it up — aim on instinct.',
  ruleAboutPits: 'Four holes around the centre. Anything that rolls in is gone, wherever it came from.',

  // -- branches of arms (§4): one board, five formations and five weights of disc.
  formationInfantry: 'Infantry',
  formationCavalry: 'Cavalry',
  formationArtillery: 'Artillery',
  formationTanks: 'Tanks',
  formationPlanes: 'Planes',

  // -- opponents ------------------------------------------------------------------------------
  // The cast replaced Easy/Medium/Hard. A description says what the character DOES at the board,
  // never how strong it is — "hard" is a number, "throws his own discs off the edge" is a person,
  // and the second is the thing a player picks by. Their spoken lines are NOT here: see
  // `game/opponents.ts` for why they stay English-only.
  opponents: 'Opponent',
  // The popup that is step two of starting a match. `opponentsMode` restates what step one settled,
  // so the two halves of the choice cannot come apart on screen.
  opponentsTitle: 'Choose your opponent',
  opponentsMode: 'Mode: {name}',
  opponentLocked: 'Beat {name} to unlock',
  oppRecruit: 'Recruit',
  oppRecruitDesc: 'Aims at whatever is nearest and pulls too hard. Posts his own discs off the far edge about as often as yours.',
  oppDrummer: 'Drummer Boy',
  oppDrummerDesc: 'Knows one shot: as hard as it goes, at whatever is in front of him. Looks at angles nobody sane would.',
  oppCook: 'Field Cook',
  oppCookDesc: 'Will not risk a disc for anything. Nudges, waits, and hopes you make the mistake first.',
  oppSergeant: 'Sergeant',
  oppSergeantDesc: 'Plays it straight, by the book, with a hand that shakes about as much as yours does.',
  oppMedic: 'Field Medic',
  oppMedicDesc: 'Will not risk a disc for anything, and only ever shoots at the ones of yours already near an edge.',
  oppQuartermaster: 'Quartermaster',
  oppQuartermasterDesc: 'Takes almost nothing off the board and leaves every disc of yours a little nearer an edge.',
  oppCavalry: 'Cavalry Captain',
  oppCavalryDesc: 'Trades every time a trade is on offer. Empties his own back rank as fast as he empties yours.',
  oppScout: 'Scout',
  oppScoutDesc: 'Looks through a fan twice as wide as anyone else. Half of what he finds is nonsense; the other half you never see coming.',
  oppGunner: 'Gunner',
  oppGunnerDesc: 'Measures his power exactly and his angle roughly — arrives with the right force at slightly the wrong place.',
  oppSapper: 'Combat Engineer',
  oppSapperDesc: 'Ignores your strays and takes the middle of your formation apart, one measured nudge at a time.',
  oppSniper: 'Sniper',
  oppSniperDesc: 'Looks at few shots and hits the one she picked. Punishes a bad position, misses the chance she never considered.',
  oppFishwife: 'Fishwife',
  oppFishwifeDesc: 'Swings as hard as she can at whatever of yours is already sliding off, and never once at anything difficult.',
  oppWatchmaker: 'Watchmaker',
  oppWatchmakerDesc: 'Plays only the shot he is certain of: a straight line and a small, exact push. Considers nothing else at all.',
  oppTeacher: 'Schoolteacher',
  oppTeacherDesc: 'Taps or hammers, with nothing in between, and will tell you exactly which one you deserved.',
  oppFerryman: 'Ferryman',
  oppFerrymanDesc: 'Ignores your strays and drives into the middle of your formation harder than the shot needs.',
  oppPartisan: 'Partisan',
  oppPartisanDesc: 'Looks at angles nobody sane would and then takes them at full force. Half of it is a bank you never saw.',
  oppChessmaster: 'Chess Master',
  oppChessmasterDesc: 'Never drives a disc if he can leave your position worse instead. Beaten by anyone willing to simply hit things.',
  oppMarshal: 'Marshal',
  oppMarshalDesc: 'Considers more shots than anyone and barely shakes at all. There is no trick left to play on him.',

  // -- match ----------------------------------------------------------------------------------
  resultWin: 'You win!',
  resultLoss: 'You lose',
  rematch: 'Play again',
  nextOpponent: 'Next rival',
  toMenu: 'Menu',
  // -- two players on one device (`GameData.twoPlayer`) --
  twoPlayerMode: 'Play a friend',
  vsBot: 'Against a bot',
  whoPlaying: 'Who are you playing?',
  startMatch: 'Start a match',
  twoPlayerAbout: 'Two of you, one device, taking turns at the same board. No coins and no ladder — just the game.',
  p1Name: 'Player 1',
  p2Name: 'Player 2',
  youName: 'You',
  p1Turn: 'Player 1 shoots',
  p2Turn: 'Player 2 shoots',
  p1Wins: 'Player 1 wins',
  p2Wins: 'Player 2 wins',
  p1Round: 'Player 1 takes the round',
  p2Round: 'Player 2 takes the round',
  p1Match: 'Player 1 wins the match',
  p2Match: 'Player 2 wins the match',
  statsWins: 'Won',
  statsLosses: 'Lost',
  roundOf: 'Round {n}/{total}',
  yourShot: 'Your shot',
  opponentShot: "Opponent's shot",
  botThinking: 'Aiming',
  extraShot: 'Again!',
  penaltyShots: 'Penalty — two shots',
  shotsLeft: '{n} shots left',
  tapToPlayAgain: 'Tap to play again',
  combo: 'Combo x{n}',
  newBest: 'Best score!',

  // -- the result panel (chunk 10) ------------------------------------------------------------
  resultRoundWin: 'Round won',
  resultRoundLoss: 'Round lost',
  resultMatchWin: 'Match won',
  resultMatchLoss: 'Match lost',
  resultDiscsLeft: 'discs left',
  resultRounds: 'rounds',
  statKnockedOut: 'Knocked out',
  statBestCombo: 'Best combo',
  statShots: 'Shots',
  statCoins: 'Coins',
  statScore: 'Score',
  badgeCleanSweep: 'Clean sweep',
  badgeComboRecord: 'Best combo yet',
  nextRound: 'Next round',
  quitMatch: 'Leave match',

  // -- the daily puzzle (§7) ------------------------------------------------------------------
  daily: 'Daily',
  dailyTitle: "Today's puzzle",
  dailyGoal: 'Clear the board in one shot',
  dailySolved: 'Solved!',
  dailyMissed: 'Not this time',
  dailyAlreadyDone: 'Already solved today',
  dailyStreak: 'Streak: {n}',
  // -- the daily result panel (`scenes/DailyResult.ts`) --
  dailyStreakDays: 'days in a row',
  dailyTargetsCleared: 'targets cleared',
  dailyStreakLabel: 'Streak',
  dailyBestStreak: 'Best streak',
  dailyStreakRecord: 'Longest streak yet!',
  dailyRetry: 'Try again',
  playMatch: 'Play a match',

  // -- economy (§8). `skin*` keys are looked up through `tOptional()` from the shop item's
  // `titleKey`, so a set shipped before its translation still shows a title-cased id.
  skins: 'Themes',
  skinDefault: 'Royal Plum',
  // Board sets. Each name says where the board IS, because a board set carries the scenery too;
  // the disc sets below are named for a material or a mood, because they carry neither.
  boardEmerald: 'Emerald Grove',
  boardSunset: 'Sunset Dunes',
  boardFrost: 'Frost Peak',
  boardSand: 'Dry Steppe',
  boardCrimson: 'Wine Dark',
  boardPlum: 'Plum',
  boardMoss: 'Moss',
  boardSlate: 'Slate',
  boardInk: 'Night Watch',
  piecesEmber: 'Ember',
  piecesTide: 'Tide',
  piecesBone: 'Bone',
  piecesBloom: 'Bloom',
  piecesCopper: 'Copper & Stone',
  piecesSignal: 'Signal',
  piecesAmethyst: 'Amethyst',
  shopEffects: 'Effects',
  fxDust: 'Dust',
  fxEmbers: 'Embers',
  fxCoins: 'Payday',
  equip: 'Equip',
  equipped: 'Worn',
  retakeShot: 'Retake',
  powerShot: 'Power shot',
  notEnoughCoins: 'Not enough coins',
  coinsEarned: '+{n} coins',
} as const

export type StringKey = keyof typeof en

const es: Record<StringKey, string> = {
  settings: 'Ajustes',
  sound: 'Sonido',
  music: 'Música',
  close: 'Cerrar',
  back: 'Atrás',
  on: 'SÍ',
  off: 'NO',
  shop: 'Tienda',
  buy: 'Comprar',
  owned: 'Comprado',
  backToMatch: 'Volver a la partida',
  shopBoards: 'Tableros',
  shopPieces: 'Fichas',
  shopTopup: '\u{1F3AC} +{n} monedas',

  gameTitle: 'Damas de Pulso',
  continueMatch: 'Continuar',
  newGame: 'Partida nueva',
  modes: 'Modos',
  navHome: 'Inicio',
  cancel: 'Cancelar',
  leaveMatch: 'Salir',
  leaveMatchAsk: '¿Salir de la partida? Tu progreso está guardado — puedes continuar desde el menú.',
  opponentNote: 'Cada rival cambia en cuántos tiros considera, qué tan firme es su puntería y qué busca — nunca en las reglas con las que juega.',

  ruleNameClassic: 'Clásicas',
  ruleNameBumper: 'Con bandas',
  ruleNameBlitz: 'Blitz',
  ruleNamePits: 'Hoyos',
  ruleWinDefault: 'Ganas: saca del tablero todas las fichas rivales.',
  ruleWinBumper: 'Ganas: mete todas las fichas rivales en un hoyo — las bandas rebotan, así que nada se cae por el borde.',
  ruleWinPits: 'Ganas: saca del tablero todas las fichas rivales, o mételas en un hoyo.',
  ruleAboutClassic: 'El turno siempre pasa. Si sacas una tuya, el rival tira dos veces.',
  ruleAboutBumper: 'Las bandas rebotan en vez de tragarse la ficha, así que cada pared es un tiro a banda — y los cuatro hoyos pasan a ser la única salida.',
  ruleAboutBlitz: 'Cinco segundos por tiro. No hay tiempo de apuntar: dispara por instinto.',
  ruleAboutPits: 'Cuatro hoyos alrededor del centro. Lo que cae dentro desaparece, sea de quien sea.',

  formationInfantry: 'Infantería',
  formationCavalry: 'Caballería',
  formationArtillery: 'Artillería',
  formationTanks: 'Tanques',
  formationPlanes: 'Aviones',

  opponents: 'Rival',
  opponentsTitle: 'Elige a tu rival',
  opponentsMode: 'Modo: {name}',
  opponentLocked: 'Gana a {name} para desbloquear',
  oppRecruit: 'Recluta',
  oppRecruitDesc: 'Apunta a lo más cercano y tira demasiado fuerte. Saca sus propias fichas del tablero casi tanto como las tuyas.',
  oppDrummer: 'Tambor',
  oppDrummerDesc: 'Solo sabe un tiro: lo más fuerte posible, contra lo que tenga delante. Mira ángulos que nadie cuerdo miraría.',
  oppCook: 'Cocinera',
  oppCookDesc: 'No arriesga una ficha por nada. Empuja, espera y confía en que te equivoques primero.',
  oppSergeant: 'Sargento',
  oppSergeantDesc: 'Juega de frente, según el manual, con un pulso que tiembla más o menos como el tuyo.',
  oppMedic: 'Médica de campaña',
  oppMedicDesc: 'No arriesga una ficha por nada, y solo dispara a las tuyas que ya están cerca del borde.',
  oppQuartermaster: 'Intendente',
  oppQuartermasterDesc: 'Casi no saca fichas y deja cada una de las tuyas un poco más cerca del borde.',
  oppCavalry: 'Capitán de Caballería',
  oppCavalryDesc: 'Cambia ficha por ficha siempre que puede. Vacía su propia fila tan rápido como la tuya.',
  oppScout: 'Explorador',
  oppScoutDesc: 'Mira un abanico el doble de ancho que los demás. La mitad de lo que encuentra es absurdo; la otra mitad no la ves venir.',
  oppGunner: 'Artillero',
  oppGunnerDesc: 'Mide la fuerza con exactitud y el ángulo a ojo: llega con la energía justa al sitio casi correcto.',
  oppSapper: 'Zapador',
  oppSapperDesc: 'Ignora tus fichas sueltas y desarma el centro de tu formación, un empujón medido cada vez.',
  oppSniper: 'Francotiradora',
  oppSniperDesc: 'Mira pocos tiros y acierta el que eligió. Castiga una mala posición y pierde la ocasión que no miró.',
  oppFishwife: 'Pescadera',
  oppFishwifeDesc: 'Golpea con toda su fuerza a cualquier ficha tuya que ya esté cayendo, y jamás a una difícil.',
  oppWatchmaker: 'Relojero',
  oppWatchmakerDesc: 'Solo juega el tiro del que está seguro: línea recta y empujón corto y exacto. No considera nada más.',
  oppTeacher: 'Maestra',
  oppTeacherDesc: 'Toca o martillea, sin nada intermedio, y te dirá exactamente cuál de los dos merecías.',
  oppFerryman: 'Barquero',
  oppFerrymanDesc: 'Ignora tus fichas sueltas y embiste el centro de tu formación con más fuerza de la necesaria.',
  oppPartisan: 'Partisana',
  oppPartisanDesc: 'Mira ángulos que nadie cuerdo miraría y luego los juega a fondo. La mitad son bandas que no viste venir.',
  oppChessmaster: 'Maestro de ajedrez',
  oppChessmasterDesc: 'Nunca saca una ficha si puede dejarte peor colocado. Lo gana quien se limite a golpear.',
  oppMarshal: 'Mariscal',
  oppMarshalDesc: 'Considera más tiros que nadie y apenas le tiembla el pulso. No queda truco que hacerle.',

  resultWin: '¡Ganaste!',
  resultLoss: 'Perdiste',
  rematch: 'Jugar otra vez',
  nextOpponent: 'Siguiente rival',
  toMenu: 'Menú',
  twoPlayerMode: 'Jugar con un amigo',
  vsBot: 'Contra un bot',
  whoPlaying: '¿Contra quién juegas?',
  startMatch: 'Empezar partida',
  twoPlayerAbout: 'Dos jugadores, un dispositivo, por turnos en el mismo tablero. Sin monedas ni escalera: solo el juego.',
  p1Name: 'Jugador 1',
  p2Name: 'Jugador 2',
  youName: 'Tú',
  p1Turn: 'Tira el jugador 1',
  p2Turn: 'Tira el jugador 2',
  p1Wins: 'Gana el jugador 1',
  p2Wins: 'Gana el jugador 2',
  p1Round: 'La ronda es del jugador 1',
  p2Round: 'La ronda es del jugador 2',
  p1Match: 'El jugador 1 gana la partida',
  p2Match: 'El jugador 2 gana la partida',
  statsWins: 'Ganadas',
  statsLosses: 'Perdidas',
  roundOf: 'Ronda {n}/{total}',
  yourShot: 'Tu tiro',
  opponentShot: 'Tira el rival',
  botThinking: 'Apuntando',
  extraShot: '¡Otra vez!',
  penaltyShots: 'Penalización: dos tiros',
  shotsLeft: 'Quedan {n} tiros',
  tapToPlayAgain: 'Toca para jugar otra vez',
  combo: 'Combo x{n}',
  newBest: '¡Récord!',

  // -- the result panel (chunk 10) ------------------------------------------------------------
  resultRoundWin: 'Ronda ganada',
  resultRoundLoss: 'Ronda perdida',
  resultMatchWin: 'Partida ganada',
  resultMatchLoss: 'Partida perdida',
  resultDiscsLeft: 'fichas restantes',
  resultRounds: 'rondas',
  statKnockedOut: 'Fichas sacadas',
  statBestCombo: 'Mejor combo',
  statShots: 'Tiros',
  statCoins: 'Monedas',
  statScore: 'Puntos',
  badgeCleanSweep: 'Sin bajas',
  badgeComboRecord: 'Mejor combo hasta ahora',
  nextRound: 'Siguiente ronda',
  quitMatch: 'Salir de la partida',

  daily: 'Diario',
  dailyTitle: 'Puzle de hoy',
  dailyGoal: 'Despeja el tablero de un tiro',
  dailySolved: '¡Resuelto!',
  dailyMissed: 'Esta vez no',
  dailyAlreadyDone: 'Ya resuelto hoy',
  dailyStreak: 'Racha: {n}',
  dailyStreakDays: 'días seguidos',
  dailyTargetsCleared: 'objetivos despejados',
  dailyStreakLabel: 'Racha',
  dailyBestStreak: 'Mejor racha',
  dailyStreakRecord: '¡Tu racha más larga!',
  dailyRetry: 'Reintentar',
  playMatch: 'Jugar partida',

  skins: 'Temas',
  skinDefault: 'Ciruela Real',
  boardEmerald: 'Bosque Esmeralda',
  boardSunset: 'Dunas del Ocaso',
  boardFrost: 'Pico Helado',
  boardSand: 'Estepa Seca',
  boardCrimson: 'Vino Oscuro',
  boardPlum: 'Ciruela',
  boardMoss: 'Musgo',
  boardSlate: 'Pizarra',
  boardInk: 'Guardia Nocturna',
  piecesEmber: 'Brasa',
  piecesTide: 'Marea',
  piecesBone: 'Hueso',
  piecesBloom: 'Flor',
  piecesCopper: 'Cobre y piedra',
  piecesSignal: 'Señal',
  piecesAmethyst: 'Amatista',
  shopEffects: 'Efectos',
  fxDust: 'Polvo',
  fxEmbers: 'Brasas',
  fxCoins: 'Botín',
  equip: 'Usar',
  equipped: 'En uso',
  retakeShot: 'Repetir',
  powerShot: 'Tiro fuerte',
  notEnoughCoins: 'Monedas insuficientes',
  coinsEarned: '+{n} monedas',
}

const STRINGS: Record<Locale, Record<StringKey, string>> = { en, es }

let currentLocale: Locale = DEFAULT_LOCALE

/**
 * BCP-47 prefix match: `'es-MX'` -> `'es'`, `'fr-FR'` -> `'fr'` -> not in `SUPPORTED_LOCALES`
 * -> falls back to `DEFAULT_LOCALE`. Written generically (not hardcoded to just `en`/`es`) so
 * adding a locale later is only a new dictionary object plus one entry in `SUPPORTED_LOCALES`.
 */
export function resolveLocale(raw: string): Locale {
  const prefix = raw.toLowerCase().split('-')[0]
  return (SUPPORTED_LOCALES as readonly string[]).includes(prefix) ? (prefix as Locale) : DEFAULT_LOCALE
}

/**
 * Called once from `main.ts`, before `new Phaser.Game(...)` (same timing as any other
 * boot-order-sensitive init) — a scene can read `t()` strings from its very first `create()`
 * call, so the locale has to already be resolved before that, not resolved lazily on first
 * use. `getLanguage()` itself never rejects (see `platform/yt.ts`), but this still guards with
 * a fallback rather than letting a hypothetical future throw there block game boot over a
 * cosmetic concern.
 */
export async function initLocale(): Promise<void> {
  try {
    currentLocale = resolveLocale(await getLanguage())
  } catch {
    currentLocale = DEFAULT_LOCALE
  }
}

/** The currently resolved locale (`DEFAULT_LOCALE` until `initLocale()` resolves). */
export function getLocale(): Locale {
  return currentLocale
}

function lookup(key: string): string | undefined {
  return (STRINGS[currentLocale] as Record<string, string>)[key] ?? (STRINGS[DEFAULT_LOCALE] as Record<string, string>)[key]
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole))
}

export function t(key: StringKey, params?: Record<string, string | number>): string {
  // lookup() can't actually miss for a real StringKey (both dictionaries are total over it,
  // enforced at compile time above) — the `?? key` is only a defensive fallback so a typo'd
  // key reads as visible mistranslated text in dev rather than throwing mid-scene.
  return interpolate(lookup(key) ?? key, params)
}

/**
 * For a dynamic, not-statically-known key (e.g. a generated/content-driven display-name key) —
 * returns `undefined` instead of the key itself on a miss, so a caller can fall back to its own
 * default (e.g. `?? rawId`) rather than displaying a raw dictionary key string.
 */
export function tOptional(key: string): string | undefined {
  return lookup(key)
}
