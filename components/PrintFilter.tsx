// Shared by the logo, which reads its files on the server, and the splash header, which runs in the browser.

// Ink speckle as a lookup over noise: one band of the noise picks dark specks, another picks specks of the green.
const band = (from: number, to: number) => Array.from({ length: 100 }, (_, i) => (i >= from && i < to ? 1 : 0)).join(' ');

// The print texture from the Figma file (Frame 288): specks of ink and of the green inside the shape, edges
// roughened by a 2px displacement, then a clean copy at 60% on top so the texture stays quiet.
// Its units are the logo's own, so the grain stays the same size relative to the logo. The region reaches 2
// past each edge, so the roughened edges aren't clipped.
export function PrintFilter({ id, viewBox }: { id: string; viewBox?: string }) {
  const [x = 0, y = 0, width = 440, height = 437] = (viewBox ?? '').split(' ').map(Number);
  return (
    <filter id={id} x={x - 2} y={y - 2} width={width + 4} height={height + 4} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="1" stitchTiles="stitch" numOctaves={3} seed={1252} result="noise" />
      <feColorMatrix in="noise" type="luminanceToAlpha" result="alphaNoise" />
      <feComponentTransfer in="alphaNoise" result="band1"><feFuncA type="discrete" tableValues={band(12, 38)} /></feComponentTransfer>
      <feComposite operator="in" in="band1" in2="SourceGraphic" result="specks1" />
      <feComponentTransfer in="alphaNoise" result="band2"><feFuncA type="discrete" tableValues={band(62, 88)} /></feComponentTransfer>
      <feComposite operator="in" in="band2" in2="SourceGraphic" result="specks2" />
      <feFlood floodColor="rgb(0 0 0 / 0.14)" />
      <feComposite operator="in" in2="specks1" result="ink" />
      <feFlood floodColor="rgb(94 118 96 / 0.29)" />
      <feComposite operator="in" in2="specks2" result="green" />
      <feMerge result="speckled"><feMergeNode in="SourceGraphic" /><feMergeNode in="ink" /><feMergeNode in="green" /></feMerge>
      <feTurbulence type="fractalNoise" baseFrequency="0.999" numOctaves={3} seed={2539} />
      <feDisplacementMap in="speckled" scale={2} xChannelSelector="R" yChannelSelector="G" />
    </filter>
  );
}
