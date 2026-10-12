import type { SectionedViewSection } from '../../core/sectioned-view.js';
export type CatalogFunction = 'Say' | 'Items' | 'Matrix' | 'Frame' | 'Media' | 'Recipes';
export interface CatalogFixture {
  id: string;
  fn: CatalogFunction;
  axis: string;
  value: string | number | boolean | readonly string[];
  caption: string;
  section: SectionedViewSection;
}
