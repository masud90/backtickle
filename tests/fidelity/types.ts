export type { ContextInputs, ContextNeeds, DocContext, RenderResult } from '@/preview/types';

import type { ContextInputs, ContextNeeds, DocContext, RenderResult } from '@/preview/types';

/** The part of a pipeline the harness uses. */
export interface EnginePipelineLike {
  needs?(source: string): ContextNeeds;
  prepare?(source: string, inputs: ContextInputs): DocContext;
  preload?(inputs: ContextInputs): Promise<void> | undefined;
  render(source: string, context?: DocContext): RenderResult;
}
