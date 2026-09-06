/**
 * The five flags in the language picker, drawn rather than typed.
 *
 * The list used emoji — `🇺🇸`, `🇧🇷` — and on Windows those are not
 * flags. Windows ships no flag glyphs, so a pair of regional indicator
 * letters falls back to drawing the letters, which is why the menu read
 * "US", "BR", "ES". The characters were right; the font had nothing to
 * show for them.
 *
 * **Simplified on purpose, at the detail a 18px box can hold.** Brazil's
 * celestial globe carries 27 stars and a banner, Spain's arms carry two
 * pillars and a crown; at this size both are a smudge. What is kept is
 * what identifies the flag across a room — the fields, their proportions
 * and their official colours. Every icon set makes the same call.
 *
 * Not a dependency: five flags is less code than the package that would
 * bring two hundred, and these never need updating.
 */

export type FlagCode = 'US' | 'BR' | 'ES' | 'RU' | 'CN';

/**
 * A five-pointed star, points up.
 *
 * Generated rather than transcribed — the four small stars on China's
 * flag are the same shape at four sizes and angles, and five copies of
 * hand-written coordinates would be five chances to differ.
 */
function star(cx: number, cy: number, radius: number, rotation = 0): string {
  const points: string[] = [];

  for (let i = 0; i < 10; i++) {
    // Alternating outer and inner radius is what makes it a star rather
    // than a decagon. 0.382 is the ratio a regular pentagram gives.
    const r = i % 2 === 0 ? radius : radius * 0.382;
    const angle = (Math.PI / 5) * i - Math.PI / 2 + rotation;

    points.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }

  return points.join(' ');
}

/** Official colours, in the order each flag names them. */
const COLOURS = {
  usRed: '#B22234',
  usBlue: '#3C3B6E',
  brGreen: '#009C3B',
  brYellow: '#FFDF00',
  brBlue: '#002776',
  esRed: '#AA151B',
  esYellow: '#F1BF00',
  ruBlue: '#0039A6',
  ruRed: '#D52B1E',
  cnRed: '#EE1C25',
  cnYellow: '#FFDE00',
  white: '#FFFFFF',
} as const;

function Us() {
  // Thirteen stripes, seven of them red. The canton covers seven of
  // those and two fifths of the width, which is the official geometry.
  const stripe = 40 / 13;

  return (
    <>
      <rect width="60" height="40" fill={COLOURS.white} />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <rect key={i} y={i * stripe} width="60" height={stripe} fill={COLOURS.usRed} />
      ))}
      <rect width="24" height={stripe * 7} fill={COLOURS.usBlue} />
      {/* Fifty stars do not survive a 7px canton. Five rows of dots read
          as the field of stars and stay legible, which is the job. */}
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2, 3, 4].map((col) => (
          <circle
            key={`${row}-${col}`}
            cx={3 + col * 4.5}
            cy={3 + row * 5}
            r="1.1"
            fill={COLOURS.white}
          />
        )),
      )}
    </>
  );
}

function Br() {
  return (
    <>
      <rect width="60" height="40" fill={COLOURS.brGreen} />
      {/* The rhombus sits 1.7/14 of the height from each edge. */}
      <polygon points="30,3.4 56.6,20 30,36.6 3.4,20" fill={COLOURS.brYellow} />
      <circle cx="30" cy="20" r="7.4" fill={COLOURS.brBlue} />
    </>
  );
}

function Es() {
  // The civil flag: red, yellow, red in a 1:2:1 band. The arms belong on
  // the state flag and are unreadable at this size anyway.
  return (
    <>
      <rect width="60" height="40" fill={COLOURS.esRed} />
      <rect y="10" width="60" height="20" fill={COLOURS.esYellow} />
    </>
  );
}

function Ru() {
  return (
    <>
      <rect width="60" height="40" fill={COLOURS.white} />
      <rect y="13.33" width="60" height="13.33" fill={COLOURS.ruBlue} />
      <rect y="26.66" width="60" height="13.34" fill={COLOURS.ruRed} />
    </>
  );
}

function Cn() {
  // One large star with four smaller ones on an arc, each turned to face
  // it — the arrangement is the flag, not the star count alone.
  const small: [number, number, number][] = [
    [20, 4, -0.3],
    [24, 8, 0.1],
    [24, 14, 0.5],
    [20, 18, 0.9],
  ];

  return (
    <>
      <rect width="60" height="40" fill={COLOURS.cnRed} />
      <polygon points={star(10, 11, 6.5)} fill={COLOURS.cnYellow} />
      {small.map(([cx, cy, rotation]) => (
        <polygon
          key={`${cx}-${cy}`}
          points={star(cx, cy, 2.2, rotation)}
          fill={COLOURS.cnYellow}
        />
      ))}
    </>
  );
}

const FLAGS: Record<FlagCode, () => JSX.Element> = {
  US: Us,
  BR: Br,
  ES: Es,
  RU: Ru,
  CN: Cn,
};

/**
 * One flag, at 3:2 — the ratio four of these five officially use.
 *
 * A hairline border because three of them are white at an edge, and on
 * a dark menu a white flag with no outline stops being a rectangle.
 */
export function Flag({ code, size = 18 }: { code: FlagCode; size?: number }) {
  const Drawing = FLAGS[code];

  return (
    <svg
      viewBox="0 0 60 40"
      width={size}
      height={(size / 3) * 2}
      className="flex-shrink-0 rounded-[1px]"
      style={{ outline: '1px solid rgba(255,255,255,0.15)', outlineOffset: -1 }}
      aria-hidden="true"
    >
      <Drawing />
    </svg>
  );
}
