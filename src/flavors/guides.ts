/** The built-in guide of each flavor (`src/content/guides/<flavor>.md`), imported lazily. */
import { type FlavorId, flavorInfo } from './index';

const guides = import.meta.glob<string>('../content/guides/*.md', {
  query: '?raw',
  import: 'default',
});

/** The flavor whose guide opens: the given one if it has a guide, else GFM. */
export function guideFlavor(flavor: FlavorId | null | undefined): FlavorId {
  return flavor && `../content/guides/${flavor}.md` in guides ? flavor : 'gfm';
}

/** The name of the guide tab: "Markdown Guide" for GFM, "<Short> Guide" for the others. */
export function guideName(flavor: FlavorId): string {
  return flavor === 'gfm' ? 'Markdown Guide' : `${flavorInfo(flavor).short} Guide`;
}

export async function loadGuide(flavor: FlavorId): Promise<string> {
  const loader = guides[`../content/guides/${guideFlavor(flavor)}.md`];
  return loader ? loader() : '';
}
