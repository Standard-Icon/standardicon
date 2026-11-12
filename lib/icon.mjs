// Builds a complete SVG from a 16px master. Used by the site build, the browser, and the CLI,
// so a copied icon, a downloaded icon, and an installed icon are byte-identical.
//
// Every size is the 16px drawing scaled up, lines included, like text: regular is a 1.33px line at 18, the
// default size, and 1.78px at 24. The weight sets the line at 18. bodyFor and scaleBody still give a body in a size's own
// units, for tools that draw at a size.

export const SIZES = [16, 18, 20, 22, 24, 28, 32, 40, 48];

const NUMBER = /-?\d*\.?\d+(?:e-?\d+)?/g;
const LENGTH_ATTRS = /\b(cx|cy|r|rx|ry|x|y|x1|x2|y1|y2|width|height|stroke-dasharray)="([^"]*)"/g;

function scaleNumbers(text, k) {
  return text.replace(NUMBER, (n) => String(+(+n * k).toFixed(3)));
}

export function scaleBody(body, size, from = 16) {
  const k = size / from;
  if (k === 1) return body;
  return body
    .replace(/\bd="([^"]*)"/g, (_, d) => `d="${scaleNumbers(d, k)}"`)
    .replace(LENGTH_ATTRS, (_, key, value) => `${key}="${scaleNumbers(value, k)}"`);
}

// Sizes without their own drawing scale up from the largest drawn size below them, so detail drawn
// for 24 carries into 28 to 48.
export function bodyFor(icon, size) {
  if (size === 16) return icon.body;
  if (icon.sizes?.[size]) return icon.sizes[size];
  const from = Math.max(16, ...Object.keys(icon.sizes ?? {}).map(Number).filter((drawn) => drawn < size));
  return scaleBody(from === 16 ? icon.body : icon.sizes[from], size, from);
}

// The size you get without asking: right for navigation, toolbars and buttons. 16 is the drawing grid.
export const DEFAULT_SIZE = 18;
// Each weight's line at the default size, 18px. Lines grow with the size, so regular is 1.18px at 16 and
// 1.78px at 24. Weights come from the line width, so only icons drawn entirely in live strokes have them:
// filled shapes would stay the same and look uneven next to a heavier line.
export const WEIGHTS = { thin: 1, regular: 1.33, semibold: 1.5, bold: 2, black: 2.5 };
export const DEFAULT_WEIGHT = 'regular';
// A weight's line in the drawing's own 16px units, which is what an SVG's stroke-width holds.
export const strokeFor = (weight) => +((WEIGHTS[weight] * 16) / DEFAULT_SIZE).toFixed(3);
// The line in pixels at a size.
export const lineAt = (weight, size) => +((WEIGHTS[weight] * size) / DEFAULT_SIZE).toFixed(2);

// Heavy lines run together at small sizes. Semibold starts at 18, so regular is the heaviest at 16.
// Bold starts at 32, and black at 40.
export const MIN_SIZE = { semibold: 18, bold: 32, black: 40 };
export const weightFits = (weight, size) => size >= (MIN_SIZE[weight] ?? 0);
export const sizesFor = (weight) => SIZES.filter((size) => weightFits(weight, size));
// Without a size, a weight starts at the default size, or the smallest it comes in if that's larger.
export const defaultSizeFor = (weight = DEFAULT_WEIGHT) => Math.max(DEFAULT_SIZE, sizesFor(weight)[0]);
export const heaviestFor = (size) => Object.keys(WEIGHTS).filter((weight) => weightFits(weight, size)).pop();
// Plain-language limits, for help text and docs.
export const LIMITS = 'Semibold comes in 18 and up, bold in 32 and up, and black in 40 and up. Lines grow with the size.';
// Which icon size goes with which text size. An icon about 1.25 times the text's size sits right beside it.
export const TEXT_SIZES = [[13, 16], [15, 18], [17, 20], [19, 22], [21, 24], [26, 28], [30, 32], [36, 40], [Infinity, 48]];
export const sizeForText = (px) => TEXT_SIZES.find(([upTo]) => px <= upTo)[1];
export const PAIRING = 'Match the icon to the text beside it: 12 to 13px text takes a 16 icon, 14 to 15px takes 18, 16 to 17px takes 20, 18 to 19px takes 22, 20 to 21px takes 24, and larger headings take 28 to 48.';

export function hasWeights(icon) {
  // Published data lists the weights. Source data marks icons whose filled parts are deliberate.
  if (Array.isArray(icon.weights)) return icon.weights.some((weight) => !ONE_WEIGHT.includes(weight));
  if (icon.solidParts) return true;
  return ![icon.body, ...Object.values(icon.sizes ?? {})].some((body) => /fill="currentColor"/.test(body));
}

// Icons with filled shapes come in one weight, drawn as they are. Thin and regular
// both give that; heavier weights aren't offered for them.
export const ONE_WEIGHT = ['thin', 'regular'];
export const weightsFor = (icon) => (hasWeights(icon) ? Object.keys(WEIGHTS) : ONE_WEIGHT);

// Sets every live stroke to the weight's line, in 16px units.
export function weighBody(body, weight = DEFAULT_WEIGHT) {
  if (WEIGHTS[weight] === undefined) throw new Error(`Unknown weight "${weight}". Use ${Object.keys(WEIGHTS).join(', ')}.`);
  const width = strokeFor(weight);
  return body.replace(/<(\w+)((?:\s[^>]*?)?)\s*\/>/g, (element, tag, attrs) => {
    if (!/stroke="currentColor"/.test(attrs)) return element;
    const rest = attrs.replace(/\sstroke-width="[^"]*"/, '');
    return `<${tag}${rest} stroke-width="${width}"/>`;
  });
}

// A body in `units` (16 for a master) shown at `size` pixels.
export function wrapSvg(body, size, units = size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${units} ${units}" fill="none">${body}</svg>`;
}

export function toSvg(icon, size, weight = DEFAULT_WEIGHT) {
  size ??= defaultSizeFor(weight);
  if (!Object.hasOwn(WEIGHTS, weight)) throw new Error(`Unknown weight "${weight}". Use ${Object.keys(WEIGHTS).join(', ')}.`);
  const fixed = !hasWeights(icon);
  if (fixed && !ONE_WEIGHT.includes(weight)) throw new Error(`${icon.name} comes in one weight, regular, because it has filled shapes.`);
  if (!weightFits(weight, size)) throw new Error(`${weight[0].toUpperCase()}${weight.slice(1)} comes in sizes ${sizesFor(weight).join(', ')}.`);
  return wrapSvg(fixed ? icon.body : weighBody(icon.body, weight), size, 16);
}
