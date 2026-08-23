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

  // -- rule sets (GAME-PLAN.md §3). `ruleName*` is the set's name; `ruleAbout*` says how it
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

  // -- the tutorial (game/tutorial.ts, scenes/Tutorial.ts) -------------------------------------
  // Six lessons, one shot each. The copy is deliberately short: it is read in a HUD band beside a
  // live board, not on a page, and a lesson nobody finishes reading is a lesson nobody has. Every
  // `hint` states the RULE the failure has just demonstrated rather than repeating the instruction —
  // "you went over the edge" teaches something "try again" does not.
  howToPlay: 'How to play',
  tutorialPlay: 'Play the tutorial',
  tutSkip: 'Skip',
  tutNext: 'Next',
  tutFinish: 'Finish',
  tutPlayMatch: 'Play a match',
  tutDone: 'That is the whole game. Everything else — the modes, the branches of arms, the coins — is in How to play.',

  tutFlickTitle: 'The flick',
  tutFlickBrief: 'Press your own disc, drag BACK, and let go. It flies away from your finger. Knock the other one off the board.',
  tutFlickHint: 'Still on the board. Drag a little further back before you let go.',
  tutFlickDone: 'That is the whole gesture. Everything after this is where you point it.',
  tutReachTitle: 'Reach',
  tutReachBrief: 'This one is in the far corner. While you drag, the line shows how far the shot carries — pull until it gets there.',
  tutReachHint: 'Short. The line ends where the disc will stop, and it grows as you pull.',
  tutReachDone: 'A full pull crosses the whole board. A gentle one barely leaves the rank.',
  tutKeepTitle: 'Your own discs leave too',
  tutKeepBrief: 'A disc is out the moment its centre crosses the edge — yours as much as theirs. Take this one and stay on the board.',
  tutKeepHint: 'Over the edge. A miss at full power runs clean across the board, and in a real round the other side then shoots twice.',
  tutKeepDone: 'Hit one square and your disc stops dead where it landed. That is why the straight shot is the safe one.',
  tutAroundTitle: 'The line stops',
  tutAroundBrief: 'One of your own is in the way. The aim line stops at the first disc it meets — go round it, or bounce off it.',
  tutAroundHint: 'Move your aim off the straight line and watch where the preview ends before you let go.',
  tutAroundDone: 'A shot that meets your own disc first is perfectly legal — and banking one off it is worth extra points.',
  tutComboTitle: 'Two at once',
  tutComboBrief: 'Three of them, bunched against the edge. Take two with one shot.',
  tutComboHint: 'One is not two. Aim into the group so the first one drives the next.',
  tutComboDone: 'Two in one shot scores four times as much as one. Three scores nine times.',
  tutClearTitle: 'Clear the board',
  tutClearBrief: 'Three of theirs against two of yours, and as many shots as you like. Take them all — that is how a round is won.',
  tutClearHint: 'You have run out of discs, which loses the round. Here it just puts the board back.',
  tutClearDone: 'Round won. A match is five of those, one for each branch of arms.',

  // -- the guided tour (game/tour.ts, scenes/Coach.ts) ------------------------------------------
  // The spotlight that rings one control at a time and says what it does. Two chapters, met on the
  // two screens they are about. Every body line has to survive being read once, over a dimmed
  // screen, by somebody who wants to get on with it — so each one says what the control DOES and
  // stops.
  coachNext: 'Next',
  coachDone: 'Got it',
  coachSkip: 'Skip',
  coachStep: '{n} of {total}',
  tourReplay: 'Show me around',

  coachHelloBody: 'Eight discs a side on one board. Flick yours into theirs until nothing of theirs is left on it. Here is what is on this screen.',
  coachPlayTitle: 'Start a match',
  coachPlayBody: 'Pick a rule set, then who you are playing — a character from the ladder, or the person sitting next to you.',
  coachDailyTitle: 'Today’s puzzle',
  coachDailyBody: 'One board, one shot, the same for everybody. A new one every day, and solving them builds a streak.',
  coachShopTitle: 'The shop',
  coachShopBody: 'Boards, disc sets and effects, paid for with the coins a match pays out. Nothing sold here aims for you.',
  coachModesTitle: 'Modes',
  coachModesBody: 'The four rule sets, each with what it changes written under it. The classic board is the one with nothing added.',
  coachBarTitle: 'Coins and settings',
  coachBarBody: 'Your balance sits at one end of this bar, the gear at the other. Behind the gear: the volume, and the rules — reachable from every screen, mid-match included.',

  coachBoardTitle: 'Your shot',
  coachBoardBody: 'Press one of your own discs, drag BACK, and release. It flies away from your finger, and the further you pull the harder it goes.',
  coachEdgeTitle: 'Off the edge',
  coachEdgeBody: 'A disc is out the moment its centre crosses the edge — yours as much as theirs. Clear their side to take the round; lose your last disc and you have lost it.',
  coachTurnTitle: 'Whose shot it is',
  coachTurnBody: 'One shot each. Knock one of your own off and they shoot twice; touch nothing at all and you simply hand over the turn.',
  coachRetakeTitle: 'Retake',
  coachRetakeBody: 'Costs coins and gives the shot back, once a round. It returns the position, never the aim.',
  coachPowerTitle: 'Power shot',
  coachPowerBody: 'Costs coins and raises the ceiling on one shot. Where it goes is still entirely your thumb.',

  // -- how to play (scenes/HowToPlay.ts) -------------------------------------------------------
  // The reference: everything the board cannot demonstrate. Note what is NOT here — the four rule
  // sets and the five branch names are read from the game's own data, so this screen cannot end up
  // describing a mode differently from the screen that picks it.
  helpGoalTitle: 'The goal',
  helpGoalA: 'Knock every one of the other side’s discs off the board. That wins a round.',
  helpGoalB: 'A match is the best of five rounds, one for each branch of arms. First to three takes it.',
  helpShotTitle: 'Your shot',
  helpShotA: 'Press one of your own discs, drag back, and release. The disc flies away from your finger, and the further you pull the harder it goes.',
  helpShotB: 'The line shows where the shot goes and how far it carries. It stops at the first disc in the way and never reports past it, so it cannot play the shot for you.',
  helpShotC: 'Changed your mind? Drag back to the disc. Under a short pull, letting go does nothing at all.',
  helpTurnTitle: 'The turn',
  helpTurnA: 'One shot each, then the other side plays. Knocking a disc off does not buy you another shot.',
  helpTurnB: 'A disc is out the moment its CENTRE crosses the edge — half of it may hang over nothing and still be in play.',
  helpTurnC: 'Knock one of your own off and the other side shoots twice. Touch nothing at all and you simply lose the turn.',
  helpModesTitle: 'Modes',
  helpModesA: 'Chosen when you start a match. Every one is won the same way; what changes is how a disc leaves the board.',
  helpBranchesTitle: 'Branches of arms',
  helpBranchesA: 'A match plays one round of each, in this order. Same board and same rules — different discs.',
  branchInfantryAbout: 'Eight in a rank. The plain disc every other branch is judged against.',
  branchCavalryAbout: 'Eight, staggered over two rows. Lighter and slipperier: they run further and are pushed off more easily.',
  branchArtilleryAbout: 'Four heavy stacks, set wide. A stack is worth two discs and breaks into them under a hard enough hit.',
  branchTanksAbout: 'Four stacks again, heavier still and the shortest-ranged thing on the board. A battering ram.',
  branchPlanesAbout: 'Eight light discs, sparse and three rows deep. They ricochet off everything and go where they like.',
  helpScoreTitle: 'Score and combos',
  helpScoreA: 'Points never decide who wins — they are what you did on top of winning. One disc off is worth 100.',
  helpScoreB: 'Two off in one shot scores 400 and three scores 900. Banking off your own disc, shooting with your last one, and taking one without moving any of your own all pay extra.',
  helpCoinsTitle: 'Coins',
  helpCoinsA: 'A match won pays 30 and a match lost 4. Each round pays 8, plus 3 for every extra disc in a combo, and the daily puzzle pays 25.',
  helpCoinsB: 'They buy the two round-time items below, and boards, discs and sparks in the shop. Nothing on sale changes a rule.',
  helpItemsTitle: 'Retake and power shot',
  helpItemsA: 'Both are bought from the two buttons beside the board, during a round — they mean nothing anywhere else.',
  helpItemsB: 'Retake (20 coins) puts the board back to just before your last shot. Once a round, so a full purse never becomes a licence to brute-force the board.',
  helpItemsC: 'Power shot (15 coins) raises the ceiling on your next shot by about a third, and is spent whether it helped or not. Where it goes is still entirely your thumb.',
  helpRivalsTitle: 'Opponents',
  helpRivalsA: 'Eighteen characters, in order of strength. Beating one in a MATCH — not a single round — opens the next.',
  helpDailyTitle: 'The daily puzzle',
  helpDailyA: 'One board, one shot, the same for everybody, and a new one at midnight UTC. Solve it to keep a streak going; a failed attempt costs nothing but the time.',
  helpFriendTitle: 'Two players',
  helpFriendA: 'Pick a mode, then choose the person next to you instead of a character, and pass the phone. No bot, no coins and no ladder — one board with two people at opposite sides of it, which is how the game is really played. The board never flips: a direction reads the same from either seat.',
  helpSkinsTitle: 'Boards and discs',
  helpSkinsA: 'Ten boards, eight sets of discs and four kinds of spark, worn in any combination. All of it is paint: no set sends a disc further than any other.',
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

  howToPlay: 'Cómo se juega',
  tutorialPlay: 'Hacer el tutorial',
  tutSkip: 'Saltar',
  tutNext: 'Siguiente',
  tutFinish: 'Terminar',
  tutPlayMatch: 'Jugar una partida',
  tutDone: 'Eso es todo el juego. Lo demás — los modos, las armas, las monedas — está en Cómo se juega.',

  tutFlickTitle: 'El tiro',
  tutFlickBrief: 'Pulsa una ficha tuya, arrastra HACIA ATRÁS y suelta. Sale disparada al lado contrario de tu dedo. Echa la otra ficha fuera del tablero.',
  tutFlickHint: 'Sigue en el tablero. Arrastra un poco más atrás antes de soltar.',
  tutFlickDone: 'Ese es todo el gesto. A partir de aquí solo cambia hacia dónde apuntas.',
  tutReachTitle: 'Alcance',
  tutReachBrief: 'Esta está en la esquina lejana. Mientras arrastras, la línea indica hasta dónde llega el tiro: tira hasta que la alcance.',
  tutReachHint: 'Corto. La línea termina donde se parará la ficha, y crece según tiras.',
  tutReachDone: 'Un tiro a fondo cruza el tablero entero. Uno suave apenas sale de la fila.',
  tutKeepTitle: 'Tus fichas también se caen',
  tutKeepBrief: 'Una ficha está fuera en cuanto su CENTRO cruza el borde, tanto la tuya como la suya. Echa esta y quédate en el tablero.',
  tutKeepHint: 'Te has salido. Un fallo a máxima potencia cruza el tablero entero, y en una ronda de verdad el rival tira dos veces.',
  tutKeepDone: 'Si le das de lleno, tu ficha se para en seco. Por eso el tiro recto es el tiro seguro.',
  tutAroundTitle: 'La línea se corta',
  tutAroundBrief: 'Tienes una ficha propia en medio. La línea de puntería se corta en la primera ficha que encuentra: rodéala, o rebota en ella.',
  tutAroundHint: 'Sal de la línea recta y mira dónde termina la vista previa antes de soltar.',
  tutAroundDone: 'Un tiro que toca antes una ficha tuya es perfectamente legal, y rebotar en ella da puntos extra.',
  tutComboTitle: 'Dos de una vez',
  tutComboBrief: 'Tres, apiñadas contra el borde. Echa dos con un solo tiro.',
  tutComboHint: 'Una no son dos. Apunta al grupo para que la primera arrastre a la siguiente.',
  tutComboDone: 'Dos en un tiro puntúan cuatro veces más que una. Tres, nueve veces más.',
  tutClearTitle: 'Despeja el tablero',
  tutClearBrief: 'Tres suyas contra dos tuyas, y todos los tiros que quieras. Échalas todas: así se gana una ronda.',
  tutClearHint: 'Te has quedado sin fichas, y eso pierde la ronda. Aquí solo repone el tablero.',
  tutClearDone: 'Ronda ganada. Una partida son cinco de estas, una por cada arma.',

  coachNext: 'Siguiente',
  coachDone: 'Entendido',
  coachSkip: 'Saltar',
  coachStep: '{n} de {total}',
  tourReplay: 'Enséñame el juego',

  coachHelloBody: 'Ocho fichas por bando en un tablero. Lanza las tuyas contra las suyas hasta que no le quede ninguna. Esto es lo que hay en esta pantalla.',
  coachPlayTitle: 'Empezar una partida',
  coachPlayBody: 'Elige un reglamento y luego contra quién juegas: un personaje de la escalera, o quien tengas al lado.',
  coachDailyTitle: 'El reto de hoy',
  coachDailyBody: 'Un tablero, un tiro, el mismo para todos. Uno nuevo cada día, y resolverlos encadena una racha.',
  coachShopTitle: 'La tienda',
  coachShopBody: 'Tableros, juegos de fichas y efectos, pagados con las monedas que dan las partidas. Nada de lo que se vende aquí apunta por ti.',
  coachModesTitle: 'Modos',
  coachModesBody: 'Los cuatro reglamentos, cada uno con lo que cambia escrito debajo. El clásico es el que no añade nada.',
  coachBarTitle: 'Monedas y ajustes',
  coachBarBody: 'Tu saldo está en un extremo de esta barra y el engranaje en el otro. Detrás del engranaje: el volumen y las reglas, disponibles en todas las pantallas, también en plena partida.',

  coachBoardTitle: 'Tu tiro',
  coachBoardBody: 'Pulsa una ficha tuya, arrastra HACIA ATRÁS y suelta. Sale disparada al lado contrario de tu dedo, y cuanto más tires, más fuerte irá.',
  coachEdgeTitle: 'Fuera del borde',
  coachEdgeBody: 'Una ficha está fuera en cuanto su centro cruza el borde, tanto la tuya como la suya. Despeja su bando y la ronda es tuya; pierde tu última ficha y la has perdido.',
  coachTurnTitle: 'A quién le toca',
  coachTurnBody: 'Un tiro cada uno. Si echas una ficha tuya, el rival tira dos veces; si no tocas nada, cedes el turno sin más.',
  coachRetakeTitle: 'Repetir',
  coachRetakeBody: 'Cuesta monedas y devuelve el tiro, una vez por ronda. Devuelve la posición, nunca la puntería.',
  coachPowerTitle: 'Tiro fuerte',
  coachPowerBody: 'Cuesta monedas y sube el tope de un solo tiro. Hacia dónde va sigue siendo cosa de tu dedo.',

  helpGoalTitle: 'El objetivo',
  helpGoalA: 'Echa fuera del tablero todas las fichas del rival. Eso gana una ronda.',
  helpGoalB: 'Una partida es al mejor de cinco rondas, una por cada arma. Gana quien llegue a tres.',
  helpShotTitle: 'Tu tiro',
  helpShotA: 'Pulsa una ficha tuya, arrastra hacia atrás y suelta. La ficha sale al lado contrario de tu dedo, y cuanto más tires más fuerte va.',
  helpShotB: 'La línea indica adónde va el tiro y hasta dónde llega. Se corta en la primera ficha que encuentra y nunca informa más allá, así que no puede jugar el tiro por ti.',
  helpShotC: '¿Te has arrepentido? Arrastra de vuelta hasta la ficha: por debajo de un tirón mínimo, soltar no hace nada.',
  helpTurnTitle: 'El turno',
  helpTurnA: 'Un tiro cada uno y pasa al rival. Echar una ficha no te da otro tiro.',
  helpTurnB: 'Una ficha está fuera en cuanto su CENTRO cruza el borde: puede tener media ficha en el aire y seguir en juego.',
  helpTurnC: 'Si echas una ficha tuya, el rival tira dos veces. Si no tocas nada, simplemente pierdes el turno.',
  helpModesTitle: 'Modos',
  helpModesA: 'Se elige al empezar la partida. Todos se ganan igual; lo que cambia es cómo sale una ficha del tablero.',
  helpBranchesTitle: 'Armas',
  helpBranchesA: 'Una partida juega una ronda de cada, en este orden. Mismo tablero y mismas reglas: otras fichas.',
  branchInfantryAbout: 'Ocho en fila. La ficha normal con la que se comparan todas las demás.',
  branchCavalryAbout: 'Ocho, escalonadas en dos filas. Más ligeras y más deslizantes: llegan más lejos y se caen con menos.',
  branchArtilleryAbout: 'Cuatro pilas pesadas, muy separadas. Una pila vale dos fichas y se parte en ellas con un golpe fuerte.',
  branchTanksAbout: 'Cuatro pilas otra vez, aún más pesadas y con el alcance más corto del juego. Un ariete.',
  branchPlanesAbout: 'Ocho fichas ligeras, dispersas y en tres filas. Rebotan en todo y van donde les da la gana.',
  helpScoreTitle: 'Puntos y combos',
  helpScoreA: 'Los puntos nunca deciden quién gana: son lo que hiciste además de ganar. Una ficha fuera vale 100.',
  helpScoreB: 'Dos en un tiro puntúan 400 y tres puntúan 900. Rebotar en una ficha tuya, tirar con la última que te queda y echar una sin mover ninguna de las tuyas pagan extra.',
  helpCoinsTitle: 'Monedas',
  helpCoinsA: 'Una partida ganada paga 30 y una perdida 4. Cada ronda paga 8, más 3 por cada ficha extra de un combo, y el reto diario paga 25.',
  helpCoinsB: 'Sirven para los dos objetos de ronda de abajo, y para tableros, fichas y chispas en la tienda. Nada de lo que se vende cambia una regla.',
  helpItemsTitle: 'Repetir y tiro fuerte',
  helpItemsA: 'Los dos se compran desde los botones que hay junto al tablero, durante una ronda: fuera de ahí no significan nada.',
  helpItemsB: 'Repetir (20 monedas) devuelve el tablero a justo antes de tu último tiro. Una vez por ronda, para que una bolsa llena no sea una licencia para probar a lo bruto.',
  helpItemsC: 'Tiro fuerte (15 monedas) sube el techo de tu siguiente tiro alrededor de un tercio, y se gasta te haya servido o no. Adónde va sigue dependiendo por completo de tu dedo.',
  helpRivalsTitle: 'Rivales',
  helpRivalsA: 'Dieciocho personajes, por orden de fuerza. Ganar a uno en una PARTIDA — no en una sola ronda — abre el siguiente.',
  helpDailyTitle: 'El reto diario',
  helpDailyA: 'Un tablero, un tiro, el mismo para todo el mundo, y uno nuevo a medianoche UTC. Resuélvelo para mantener la racha; fallar no cuesta más que el tiempo.',
  helpFriendTitle: 'Dos jugadores',
  helpFriendA: 'Elige un modo, elige a la persona que tienes al lado en vez de a un personaje, y pasad el móvil. Sin bot, sin monedas y sin escalafón: un tablero con dos personas en lados opuestos, que es como se juega de verdad. El tablero no gira: una dirección se lee igual desde cualquier asiento.',
  helpSkinsTitle: 'Tableros y fichas',
  helpSkinsA: 'Diez tableros, ocho juegos de fichas y cuatro tipos de chispa, en cualquier combinación. Todo es pintura: ningún juego manda una ficha más lejos que otro.',
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
