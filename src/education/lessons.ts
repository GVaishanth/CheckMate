import { START_FEN } from '../chess/constants';
import openingCatalog from './opening-catalog.json';
import matingCatalog from './mating-catalog.json';

export type LessonKind = 'opening' | 'checkmate';
export type LessonStage = 'study' | 'practice' | 'recall';
export type LessonSide = 'white' | 'black';
export interface LessonStep { uci: string; note: string }
export interface Lesson {
  id: string;
  kind: LessonKind;
  title: string;
  level: 'Start here' | 'Build on it';
  courseLevel: number;
  topic?: string;
  eco?: string;
  side: LessonSide;
  summary: string;
  goal: string;
  ideas: string[];
  remember: string;
  watchOut: string;
  startFen: string;
  steps: LessonStep[];
  mateIn?: number;
}

const steps = (rows: [string, string][]): LessonStep[] => rows.map(([uci, note]) => ({ uci, note }));

const ORIGINAL_LESSONS: Omit<Lesson, 'courseLevel'>[] = [
  {
    id: 'italian-game', kind: 'opening', title: 'Italian Game', level: 'Start here', side: 'white',
    summary: 'A natural first opening: take the centre, bring out your pieces, and castle.',
    goal: 'Develop towards the centre without leaving your king behind.',
    ideas: ['A central pawn makes room for your pieces.', 'Knights and bishops develop before the queen.', 'The bishop on c4 looks towards f7, but development comes before an attack.'],
    remember: 'Centre → knight → bishop → support → castle.',
    watchOut: 'Do not rush a queen attack on f7. Black can defend it while gaining time.',
    startFen: START_FEN,
    steps: steps([
      ['e2e4', 'Take central space and open the diagonal for your light-squared bishop.'],
      ['e7e5', 'Black takes an equal share of the centre.'],
      ['g1f3', 'Develop a knight with a threat against the e5 pawn.'],
      ['b8c6', 'Black develops a knight and protects that pawn.'],
      ['f1c4', 'Aim the bishop at f7. This bishop move identifies the Italian Game.'],
      ['f8c5', 'Black develops actively too. Both sides are ready to support the centre.'],
      ['c2c3', 'Prepare a well-supported d4 push for later.'],
      ['g8f6', 'Black develops with pressure on e4.'],
      ['d2d3', 'Support e4 and open a path for the other bishop.'],
      ['d7d6', 'Black supports the centre rather than starting an early attack.'],
      ['e1g1', 'Castle: your king is safer and the rook moves towards the centre.'],
      ['e8g8', 'Both kings are safe. Continue developing before choosing a central break.'],
    ]),
  },
  {
    id: 'london-system', kind: 'opening', title: 'London System', level: 'Start here', side: 'white',
    summary: 'Build a steady setup around d4, Nf3 and Bf4.',
    goal: 'Develop the dark-squared bishop before closing its diagonal with e3.',
    ideas: ['The bishop goes outside the pawn chain first.', 'The d4 and e3 pawns support each other.', 'A familiar setup helps, but you still have to react to threats.'],
    remember: 'd4 → Nf3 → bishop out → e3 → finish development.',
    watchOut: 'A system is not permission to ignore Black. Watch attacks on b2 and the centre.',
    startFen: START_FEN,
    steps: steps([
      ['d2d4', 'Claim central space and open the dark-squared bishop’s diagonal.'],
      ['d7d5', 'Black meets the centre directly.'],
      ['g1f3', 'Develop a knight and reinforce d4.'],
      ['g8f6', 'Black develops and adds pressure to the central squares.'],
      ['c1f4', 'Bring the bishop outside your future pawn chain.'],
      ['e7e6', 'Black prepares to develop the dark-squared bishop.'],
      ['e2e3', 'Support d4 now that your bishop is safely outside.'],
      ['f8d6', 'Black challenges your active bishop.'],
      ['f4g3', 'Keep the bishop and maintain pressure along its diagonal.'],
      ['e8g8', 'Black castles. Your king needs attention too.'],
      ['f1d3', 'Develop your last kingside piece and look towards h7.'],
      ['c7c5', 'Black challenges your central pawn structure.'],
      ['e1g1', 'Finish the setup with a safe king.'],
      ['b8c6', 'Both sides can now choose how to resolve the central tension.'],
    ]),
  },
  {
    id: 'scotch-game', kind: 'opening', title: 'Scotch Game', level: 'Start here', side: 'white',
    summary: 'Open the centre early and develop into the space you create.',
    goal: 'Use d4 to challenge Black’s central pawn.',
    ideas: ['A central exchange opens lines for both players.', 'Recapturing with a knight develops it actively.', 'Open positions reward quick development and king safety.'],
    remember: 'e4 / Nf3 → d4 → recapture with the knight.',
    watchOut: 'An open centre is dangerous for an uncastled king. Do not spend every turn moving the same piece.',
    startFen: START_FEN,
    steps: steps([
      ['e2e4', 'Take central space.'], ['e7e5', 'Black claims the centre too.'],
      ['g1f3', 'Develop and attack e5.'], ['b8c6', 'Black defends the pawn with a developing move.'],
      ['d2d4', 'Challenge the e5 pawn immediately. This is the Scotch.'],
      ['e5d4', 'Black exchanges the central pawns.'],
      ['f3d4', 'Recapture with the knight, placing a piece in the centre.'],
      ['g8f6', 'Black develops while attacking e4.'],
      ['b1c3', 'Protect e4 and develop your other knight.'],
      ['f8b4', 'Black pins the knight. Continue development and prepare to castle.'],
    ]),
  },
  {
    id: 'queens-gambit', kind: 'opening', title: 'Queen’s Gambit Declined', level: 'Start here', side: 'white',
    summary: 'Challenge d5 with a flank pawn and build pressure behind it.',
    goal: 'Offer the c-pawn to contest Black’s central foothold.',
    ideas: ['The c-pawn attacks d5 without moving your own d-pawn.', 'Black’s e6 defends d5 but limits the c8 bishop.', 'Development makes your central pressure useful.'],
    remember: 'd4 / c4 → develop → pin → support the centre.',
    watchOut: 'The gambit is not a forced pawn sacrifice. Do not chase material while neglecting development.',
    startFen: START_FEN,
    steps: steps([
      ['d2d4', 'Occupy the centre.'], ['d7d5', 'Black mirrors your central claim.'],
      ['c2c4', 'Challenge d5 with a wing pawn. This is the Queen’s Gambit.'],
      ['e7e6', 'Black declines the gambit and supports d5.'],
      ['b1c3', 'Develop with more pressure on d5.'], ['g8f6', 'Black reinforces the centre.'],
      ['c1g5', 'Pin the knight to the queen before playing e3.'],
      ['f8e7', 'Black breaks the pin and prepares to castle.'],
      ['e2e3', 'Support d4 and open the light-squared bishop’s diagonal.'],
      ['e8g8', 'Black secures the king.'],
      ['g1f3', 'Develop another piece and prepare your own castling.'],
      ['b8d7', 'Black completes the knight development. The central tension remains.'],
    ]),
  },
  {
    id: 'caro-kann', kind: 'opening', title: 'Caro–Kann Defence', level: 'Start here', side: 'black',
    summary: 'Support a central counterattack, then develop the bishop outside the pawn chain.',
    goal: 'Prepare d5 with c6 and challenge White’s e4 pawn.',
    ideas: ['The first pawn move prepares a second one.', 'Exchange on e4 before developing the light-squared bishop.', 'Get that bishop out before playing e6.'],
    remember: 'c6 → d5 → exchange → bishop out.',
    watchOut: 'Playing e6 too early can trap your c8 bishop behind its own pawns.',
    startFen: START_FEN,
    steps: steps([
      ['e2e4', 'White claims the centre. You will challenge it rather than copy it.'],
      ['c7c6', 'Prepare a supported advance to d5.'],
      ['d2d4', 'White builds a two-pawn centre.'], ['d7d5', 'Attack e4 with a pawn supported by c6.'],
      ['b1c3', 'White defends e4 and develops.'],
      ['d5e4', 'Resolve the central tension and invite a knight recapture.'],
      ['c3e4', 'White recaptures in the centre.'],
      ['c8f5', 'Develop the bishop outside the pawn chain before playing e6.'],
      ['e4g3', 'White gains a tempo by attacking that bishop.'],
      ['f5g6', 'Retreat safely. Next, support the centre and bring out the knights.'],
    ]),
  },
  {
    id: 'french-advance', kind: 'opening', title: 'French Defence: Advance', level: 'Build on it', side: 'black',
    summary: 'Let White gain space, then attack the base of the pawn chain.',
    goal: 'Challenge d4 with c5 rather than pushing against the head of the chain.',
    ideas: ['White’s e5 pawn gains space but needs support.', 'The d4 pawn is the base of the central chain.', 'Your c-pawn and pieces work together against d4.'],
    remember: 'e6 → d5 → attack the base with c5.',
    watchOut: 'The c8 bishop has limited space. Do not forget to find a route for it later.',
    startFen: START_FEN,
    steps: steps([
      ['e2e4', 'White claims the centre.'], ['e7e6', 'Prepare d5 with pawn support.'],
      ['d2d4', 'White occupies more central space.'], ['d7d5', 'Challenge e4 immediately.'],
      ['e4e5', 'White gains space and closes the centre.'],
      ['c7c5', 'Attack d4, the base that holds White’s central chain together.'],
      ['c2c3', 'White reinforces d4.'], ['b8c6', 'Add a developing attacker against d4.'],
      ['g1f3', 'White develops and adds another defender.'],
      ['d8b6', 'The queen increases pressure on d4 and also eyes b2.'],
    ]),
  },
  {
    id: 'sicilian-classical', kind: 'opening', title: 'Sicilian Defence: Classical', level: 'Build on it', side: 'black',
    summary: 'Trade a wing pawn for a central pawn and build an unbalanced position.',
    goal: 'Contest d4 from the side and develop before seeking counterplay.',
    ideas: ['The c5 pawn contests d4 without mirroring e4.', 'The exchange opens the c-file for Black.', 'The knight on f6 develops with a threat to e4.'],
    remember: 'c5 / d6 → exchange on d4 → knights out.',
    watchOut: 'An open c-file is a future resource, not a reason to ignore king safety.',
    startFen: START_FEN,
    steps: steps([
      ['e2e4', 'White opens with a central pawn.'],
      ['c7c5', 'Control d4 from the flank. This creates an asymmetric pawn structure.'],
      ['g1f3', 'White develops and prepares d4.'],
      ['d7d6', 'Control e5 and open a route for your light-squared bishop.'],
      ['d2d4', 'White challenges the centre.'],
      ['c5d4', 'Trade your c-pawn for White’s central d-pawn.'],
      ['f3d4', 'White recaptures with an active knight.'],
      ['g8f6', 'Develop with an attack on e4.'],
      ['b1c3', 'White protects e4 with a developing move.'],
      ['b8c6', 'Develop your other knight. This is a Classical Sicilian setup.'],
    ]),
  },
  {
    id: 'ruy-lopez', kind: 'opening', title: 'Ruy Lopez', level: 'Build on it', side: 'white',
    summary: 'Pressure the defender of e5, keep your bishop, and castle.',
    goal: 'Create lasting pressure without rushing a capture on c6.',
    ideas: ['Bb5 pressures the knight that defends e5.', 'The bishop can retreat and remain useful.', 'Castling comes before trying to win a central pawn.'],
    remember: 'e4 / Nf3 → Bb5 → retreat → castle.',
    watchOut: 'Bxc6 does not automatically win e5; Black often has a tactical way to recover the pawn.',
    startFen: START_FEN,
    steps: steps([
      ['e2e4', 'Take central space.'], ['e7e5', 'Black takes central space too.'],
      ['g1f3', 'Develop with an attack on e5.'], ['b8c6', 'Black defends e5 with a knight.'],
      ['f1b5', 'Pressure that defender. This is the Ruy Lopez.'],
      ['a7a6', 'Black asks the bishop to choose a square.'],
      ['b5a4', 'Keep the bishop and preserve the pressure.'],
      ['g8f6', 'Black develops and attacks e4.'],
      ['e1g1', 'Castle rather than chasing a pawn. Your rook can soon support the centre.'],
      ['f8e7', 'Black prepares to castle. Both sides still have central decisions to make.'],
    ]),
  },
  {
    id: 'kings-indian', kind: 'opening', title: 'King’s Indian Defence', level: 'Build on it', side: 'black',
    summary: 'Build a safe kingside, then strike at White’s large centre.',
    goal: 'Fianchetto the bishop and prepare the central break e5.',
    ideas: ['The bishop on g7 puts long-range pressure on the centre.', 'Castling makes the central counterattack safer.', 'Giving up space requires active counterplay, not passive waiting.'],
    remember: 'Knight → g6 / Bg7 → d6 → castle → e5.',
    watchOut: 'White has more space. Do not let the centre grow without preparing a pawn break.',
    startFen: START_FEN,
    steps: steps([
      ['d2d4', 'White claims space.'], ['g8f6', 'Develop and control e4.'],
      ['c2c4', 'White expands on the queenside.'], ['g7g6', 'Prepare to place your bishop on the long diagonal.'],
      ['b1c3', 'White develops.'], ['f8g7', 'Fianchetto the bishop: it looks towards the centre from g7.'],
      ['e2e4', 'White builds a broad pawn centre.'],
      ['d7d6', 'Hold e5 under control and prepare to challenge the centre.'],
      ['g1f3', 'White completes the kingside knight development.'],
      ['e8g8', 'Secure your king before opening the centre.'],
      ['f1e2', 'White prepares to castle too.'],
      ['e7e5', 'Strike at the centre. Your setup now has an active plan.'],
    ]),
  },
  {
    id: 'scandinavian', kind: 'opening', title: 'Scandinavian Defence', level: 'Build on it', side: 'black',
    summary: 'Challenge the centre immediately and learn what an early queen costs.',
    goal: 'Recapture on d5, move the queen safely, and catch up in development.',
    ideas: ['The d5 pawn directly challenges e4.', 'An early queen can be attacked by developing pieces.', 'Choose a safe queen square, then develop the rest of the army.'],
    remember: 'd5 → recapture → queen to safety → develop.',
    watchOut: 'Do not go pawn-hunting with the queen while White develops with tempo.',
    startFen: START_FEN,
    steps: steps([
      ['e2e4', 'White claims the centre.'], ['d7d5', 'Challenge e4 straight away.'],
      ['e4d5', 'White accepts the exchange.'], ['d8d5', 'Recover the pawn with the queen.'],
      ['b1c3', 'White develops with a direct attack on your queen.'],
      ['d5a5', 'Move the queen out of the attack. This is one established route.'],
      ['d2d4', 'White builds a central foothold.'], ['g8f6', 'Develop and increase control of the centre.'],
      ['g1f3', 'White develops another piece.'],
      ['c7c6', 'Support a future central advance and give the queen a retreat along the diagonal.'],
    ]),
  },
  {
    id: 'back-rank', kind: 'checkmate', title: 'Back-rank mate', level: 'Start here', side: 'white', mateIn: 1,
    summary: 'A rook uses the last rank while the king’s own pawns shut the exits.',
    goal: 'Find checkmate in one move.',
    ideas: ['The checking rook controls the whole back rank.', 'The king’s own pawns block the squares in front of it.', 'Check every escape square before declaring mate.'],
    remember: 'Closed pawn shield + open back rank = look for a rook check.',
    watchOut: 'If the king has a flight square, the same rook check may not be mate.',
    startFen: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1',
    steps: steps([['e1e8', 'The rook owns the eighth rank. The pawns on f7, g7 and h7 leave the king no exit.']]),
  },
  {
    id: 'supported-queen', kind: 'checkmate', title: 'The supported queen', level: 'Start here', side: 'white', mateIn: 1,
    summary: 'The queen gets close to the king, with a bishop guarding her landing square.',
    goal: 'Find checkmate in one move.',
    ideas: ['A queen beside a king controls many escape squares.', 'Your bishop protects the queen from capture.', 'The defending rook also occupies an escape square.'],
    remember: 'Bring the queen close only when another piece has her back.',
    watchOut: 'An unprotected queen next to the king can simply be captured.',
    startFen: '5rk1/5ppp/8/7Q/8/3B4/8/6K1 w - - 0 1',
    steps: steps([['h5h7', 'The bishop on d3 protects the queen on h7. The queen covers the king’s exits, and f8 is occupied.']]),
  },
  {
    id: 'smothered-mate', kind: 'checkmate', title: 'Smothered mate', level: 'Start here', side: 'white', mateIn: 1,
    summary: 'A knight jumps over the shield that traps the enemy king.',
    goal: 'Find checkmate in one move.',
    ideas: ['A knight check cannot be blocked.', 'Friendly pieces can trap their own king.', 'Only moving the king or capturing the knight could answer this check.'],
    remember: 'A boxed-in king is vulnerable to a knight jump.',
    watchOut: 'Look for a defender that can capture the knight. A cramped king alone is not enough.',
    startFen: '6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1',
    steps: steps([['h6f7', 'The knight attacks h8. Black’s rook and pawns fill every escape square, and none can capture the knight.']]),
  },
  {
    id: 'ladder-mate', kind: 'checkmate', title: 'The rook ladder', level: 'Start here', side: 'white', mateIn: 2,
    summary: 'Two rooks take turns cutting off ranks until the king runs out of board.',
    goal: 'Force checkmate in at most two of your moves.',
    ideas: ['One rook builds a wall; the other gives check.', 'A checking rook pushes the king towards the edge.', 'Keep the rooks far enough from the king to avoid capture.'],
    remember: 'One rook cuts off. The other steps past it. Repeat.',
    watchOut: 'Do not put a rook beside the enemy king unless it is protected.',
    startFen: '8/5k2/R7/8/8/8/8/1R4K1 w - - 0 1',
    steps: steps([
      ['b1b7', 'The rook on a6 blocks the sixth rank. A check on the seventh forces the king to the eighth.'],
      ['f7f8', 'The king stays on the only remaining rank. Other retreats along it meet the same idea.'],
      ['a6a8', 'The second rook steps past its partner. One rook seals the seventh rank; the other checks along the eighth.'],
    ]),
  },
  {
    id: 'arabian-mate', kind: 'checkmate', title: 'Arabian mate', level: 'Build on it', side: 'white', mateIn: 1,
    summary: 'Rook and knight cooperate against a king in the corner.',
    goal: 'Find checkmate in one move.',
    ideas: ['The rook gives the check next to the king.', 'The knight protects the rook and covers a flight square.', 'The corner leaves the defender very little room.'],
    remember: 'The rook checks; the knight protects and closes the corner.',
    watchOut: 'Count the knight’s squares carefully: here it must both protect h7 and cover g8.',
    startFen: '7k/6pp/5N2/8/8/8/8/6KR w - - 0 1',
    steps: steps([['h1h7', 'The knight on f6 protects h7 and covers g8. The rook checks, while Black’s g7 pawn blocks the remaining exit.']]),
  },
  {
    id: 'anastasia-mate', kind: 'checkmate', title: 'Anastasia’s mate', level: 'Build on it', side: 'white', mateIn: 1,
    summary: 'A knight closes the exits while a rook takes the open edge file.',
    goal: 'Find checkmate in one move.',
    ideas: ['The rook needs an open file towards the king.', 'The knight takes away the king’s sideways escape.', 'A defending pawn can complete the cage.'],
    remember: 'Knight closes the door. Rook takes the file.',
    watchOut: 'A pawn between rook and king would interrupt the check. Verify the whole file is clear.',
    startFen: '7k/4N1p1/8/8/8/8/6K1/R7 w - - 0 1',
    steps: steps([['a1h1', 'The rook checks along the h-file. The knight covers g8, and Black’s g7 pawn closes the other exit.']]),
  },
  {
    id: 'queen-and-king', kind: 'checkmate', title: 'Queen & king: the final box', level: 'Build on it', side: 'white', mateIn: 3,
    summary: 'Bring your king closer before delivering the final queen check.',
    goal: 'Force checkmate in at most three of your moves.',
    ideas: ['Your king controls escape squares the queen cannot cover alone.', 'A quiet queen move can take away space without giving check.', 'Always distinguish checkmate from stalemate.'],
    remember: 'King closer → queen makes a wall → final check.',
    watchOut: 'A trapped king that is not in check is stalemated. Do not take away its last move too soon.',
    startFen: '3k4/8/8/2K5/8/8/8/7Q w - - 0 1',
    steps: steps([
      ['c5d6', 'Bring your king up to control the seventh-rank escape squares.'],
      ['d8e8', 'The defender shuffles along the edge.'],
      ['h1f1', 'The queen makes a vertical wall. The king must step away from it.'],
      ['e8d8', 'The king returns to d8, still held on the back rank.'],
      ['f1f8', 'The queen checks along the eighth rank while your king covers the exits below it.'],
    ]),
  },
  {
    id: 'rook-and-king', kind: 'checkmate', title: 'Rook & king: opposition', level: 'Build on it', side: 'white', mateIn: 3,
    summary: 'Your king takes the escape squares; the rook delivers the finishing check.',
    goal: 'Force checkmate in at most three of your moves.',
    ideas: ['A rook cannot cover every nearby escape square by itself.', 'Bring your king close without letting the kings touch.', 'A waiting move can force the defending king into opposition.'],
    remember: 'King closer → rook waits → king opposite → rook checks.',
    watchOut: 'Checking too early lets the king step towards the centre. Use your king first.',
    startFen: '3k4/8/8/2K5/8/8/8/7R w - - 0 1',
    steps: steps([
      ['c5d6', 'Your king takes c7, d7 and e7. The defender must stay near the edge.'],
      ['d8e8', 'The defending king steps away from direct opposition.'],
      ['h1f1', 'A waiting move cuts off the f-file and passes the turn back.'],
      ['e8d8', 'The king is now opposite yours. The escape squares below it are covered.'],
      ['f1f8', 'The rook checks along the back rank. Your king supplies the missing control.'],
    ]),
  },
];

const ORIGINAL_LEVELS: Record<string, number> = {
  'italian-game': 1, 'london-system': 1, 'scotch-game': 1, 'queens-gambit': 1,
  'caro-kann': 1, scandinavian: 1, 'french-advance': 4, 'sicilian-classical': 5,
  'ruy-lopez': 3, 'kings-indian': 7, 'back-rank': 1, 'supported-queen': 1,
  'smothered-mate': 2, 'arabian-mate': 2, 'anastasia-mate': 2,
  'ladder-mate': 6, 'queen-and-king': 6, 'rook-and-king': 6,
};

export const LESSONS: Lesson[] = [
  ...ORIGINAL_LESSONS.map((lesson) => ({ ...lesson, courseLevel: ORIGINAL_LEVELS[lesson.id]! })),
  ...openingCatalog as Lesson[],
  ...matingCatalog as Lesson[],
].sort((a, b) => a.kind === b.kind ? a.courseLevel - b.courseLevel : a.kind === 'opening' ? -1 : 1);

export const lessonById = (id: string): Lesson | undefined => LESSONS.find((lesson) => lesson.id === id);
