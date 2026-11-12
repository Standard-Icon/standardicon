// Custom events for the visitor metrics at m.rgan.co. The tracker only loads on the live site,
// so this does nothing on localhost and the preview. Never pass an edit token here.
declare global {
  interface Window {
    mm?: { track: (name: string, props?: Record<string, unknown>) => void };
  }
}

export const track = (name: string, props?: Record<string, unknown>) => window.mm?.track(name, props);
