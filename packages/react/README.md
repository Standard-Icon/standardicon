# @standardicon/react

> **Early version.** This is an alpha. Names, sizes and defaults may still change before 1.0.0, so pin the version if you depend on it.

[The Standard Icon Set](https://standardicon.com) as React components. Line icons drawn on a 16px grid, in nine sizes and five weights. MIT licensed.

```sh
npm install @standardicon/react
```

```tsx
import { ClockIcon, TrashIcon } from '@standardicon/react';

<ClockIcon />                                  // 18px, regular
<ClockIcon size={24} />                        // lines grow with the size
<TrashIcon size={20} weight="semibold" />
<TrashIcon title="Delete" />                   // named for screen readers
```

## Props

| Prop | Values | Default |
| --- | --- | --- |
| `size` | 16, 18, 20, 22, 24, 28, 32, 40, 48 | 18, the size for navigation, toolbars and buttons, or the smallest size the weight comes in |
| `weight` | Lines at 18px: `thin` (1px), `regular` (1.33px), `semibold` (1.5px), `bold` (2px), `black` (2.5px) | `regular` |
| `title` | Names the icon for screen readers. Without a title or `aria-label`, the icon is `aria-hidden`. | |

Every other SVG prop (`className`, `style`, `onClick`, a `ref`) goes to the `<svg>`.

- **Lines grow with the size**, like text: regular is 1.33px at 18 and 1.78px at 24.
- **Heavy weights start at larger sizes:** semibold from 18, bold from 32, black from 40. The types won't accept `weight="semibold" size={16}`.
- **Icons with filled shapes come in one weight**, regular. Their components only accept `thin` or `regular`.
- **Icons draw in `currentColor`**, so they take the color of the text around them.
- Only the icons you import end up in your bundle.

Hover a component in your editor to see what the icon looks like and when to use it.

## Picking a size

Pick `size` from the text beside the icon: 12 to 13px text takes 16, 14 to 15px takes 18 (the default), 16 to 17px takes 20, 18 to 19px takes 22, 20 to 21px takes 24, and larger headings take 28 to 48. A heading in larger type needs a larger icon than the items under it.

## Finding icons

Components are the icon name in PascalCase plus `Icon`: `arrow-up` is `ArrowUpIcon`, `skip-back-10` is `SkipBack10Icon`. To find one by meaning, or to switch from another set:

```sh
npx standardicon search bell with a plus
npx standardicon from lucide x Trash2 ChevronDown
```

## License

MIT, for the icons and the code.
