import { allRecords } from '../lib/records.mjs';

// Icons that keep small filled parts on purpose, such as dots and squares. Weights still apply:
// their strokes get heavier and the filled parts stay as drawn. Any other filled shape keeps an icon at
// regular only, because it's usually a stroke that was flattened by mistake.
// They're marked with fillApproved in their records.
export const SOLID_PARTS = new Set(allRecords().filter((record) => record.fillApproved).map((record) => record.name));

// Families whose filled parts are part of the design. File-type icons label the page with filled letters,
// such as PDF. A filled shape wider or taller than MAX_FAMILY_FILL on the 16px grid is still treated as a
// mistake, so a flattened page outline doesn't slip through.
export const SOLID_FAMILIES = [/^file-/];
export const MAX_FAMILY_FILL = 8;

export const allowsSolidParts = (name) => SOLID_PARTS.has(name) || SOLID_FAMILIES.some((pattern) => pattern.test(name));
