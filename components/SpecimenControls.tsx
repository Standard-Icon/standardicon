'use client';

import { useEffect, useState } from 'react';
import { SIZES, WEIGHTS, heaviestFor, sizesFor, weightFits, strokeFor } from '@/lib/icon.mjs';
import { track } from '@/lib/track';

type Weight = keyof typeof WEIGHTS;
const LABELS: Record<Weight, string> = { thin: 'Thin', regular: 'Regular', semibold: 'Semibold', bold: 'Bold', black: 'Black' };

// Size and weight for the splash page's wall of icons. The two follow the set's own rules: picking a
// weight a size doesn't come in moves to the smallest size that does, and picking a size too small
// for the weight drops to the heaviest weight it comes in. The radios are named apart from the
// site's own pickers, which the shared interactions listen for.
export function SpecimenControls() {
  const [size, setSize] = useState(24);
  const [weight, setWeight] = useState<Weight>('regular');

  useEffect(() => {
    const wall = document.getElementById('specimen');
    wall?.style.setProperty('--size', `${size}px`);
    wall?.style.setProperty('--weight', String(strokeFor(weight)));
  }, [size, weight]);

  const pickSize = (next: number) => {
    setSize(next);
    if (!weightFits(weight, next)) setWeight(heaviestFor(next) as Weight);
    track('specimen_change', { option: 'size', value: next });
  };
  const pickWeight = (next: Weight) => {
    setWeight(next);
    if (!weightFits(next, size)) setSize(sizesFor(next)[0]);
    track('specimen_change', { option: 'weight', value: next });
  };

  return (
    <div className="specimen-tools">
      <fieldset className="sizes">
        {SIZES.map((option) => (
          <label key={option}>
            <input type="radio" name="specimen-size" value={option} checked={option === size} onChange={() => pickSize(option)} />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="sizes weights">
        {(Object.keys(WEIGHTS) as Weight[]).map((option) => (
          <label key={option}>
            <input type="radio" name="specimen-weight" value={option} checked={option === weight} onChange={() => pickWeight(option)} />
            <span>{LABELS[option]}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
