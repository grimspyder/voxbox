// Decides whether an utterance is likely to need information that only exists
// after the model's training — the trigger for the automatic Grok lookup.
//
// This is a cheap, conservative pre-filter, not the decision itself: Grok still
// decides whether to actually search. Being wrong in the "false" direction costs
// nothing (Vox answers normally, as it always has); being wrong in the "true"
// direction costs one extra background call per turn, so the cues are kept tight
// and pure chit-chat is left alone.

const RECENCY_CUES =
  /\b(latest|newest|today|tonight|yesterday|tomorrow|current|currently|right now|just now|nowadays|recent|recently|so far|this (week|month|year|morning|afternoon|evening)|as of|up[ -]to[ -]date|news|headline|breaking|update|score|scores|standings|price|prices|stock|stocks|crypto|exchange rate|weather|forecast|temperature|rain|snow|who won|who is winning|who's winning|when (is|does|did|will)|release date|how much (is|are|does|do|did)|how many (are|is|were)|trending|viral|released|announced|launch(ed|ing)?|election|poll[s]?)\b/i;

const YEAR_CUE = /\b(20(2[4-9]|3\d))\b/;

export function needsRealtime(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return false;
  // A bare greeting or a purely personal statement never needs the web.
  if (/^(hi|hey|hello|yo|good (morning|evening|afternoon)|thanks|thank you|ok|okay|cool|nice)\b[.!?]*$/i.test(t)) {
    return false;
  }
  return RECENCY_CUES.test(t) || YEAR_CUE.test(t);
}
