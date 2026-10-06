import type { KbCategory } from './types.ts';

/**
 * Lightweight intent detection: maps how customers phrase things onto KB
 * categories. This is the synonym layer that plain keyword search lacks
 * ("money back" has no word in common with "Refund policy").
 *
 * Deliberately simple and deterministic: it costs nothing, it is easy to
 * explain, and the categories it detects only *boost* retrieval — the
 * final cut is still made by search_kb's score threshold.
 */
const INTENT_PATTERNS: Record<KbCategory, RegExp> = {
  damaged_items:
    /\b(broke|broken|break|crack(ed)?|damag(e|ed)|leak(ed|ing|s)?|shatter(ed)?|spill(ed)?|defect(ive)?|smash(ed)?|dent(ed)?|torn|faulty|tamper(ed)?|seal (was )?(open|broken)|missing seal|replace(ment)?)\b/i,
  refunds: /\b(refund(s|ed)?|money back|reimburse(ment)?|charge ?back|paisa wapas|get my money)\b/i,
  returns: /\b(return(s|ed|ing)?|send (it |this |them )?back|exchange|pick ?up)\b/i,
  cancellation: /\b(cancel(l?ed|l?ing|lation)?|don'?t want (it|this|the order) anymore|stop (the|my) order)\b/i,
  shipping:
    /\b(ship(ping|ped)?|when will|arriv(e|al)|track(ing)?|courier|dispatch(ed)?|where is my (order|parcel|package)|not (yet )?(received|delivered)|delay(ed)?|late|delivery (time|date|charge|fee)|express)\b/i,
  general: /\b(contact|phone number|call you|email|working hours|support hours|timings?|open (on|today)|customer care)\b/i,
};

export function detectIntents(text: string): KbCategory[] {
  return (Object.keys(INTENT_PATTERNS) as KbCategory[]).filter((c) => INTENT_PATTERNS[c].test(text));
}

const INJECTION_PATTERN =
  /(ignore|disregard|forget|override)\s+(all\s+|any\s+|your\s+|the\s+|previous\s+|prior\s+|above\s+)*(instructions|rules|polic(y|ies)|guidelines|prompt)|system prompt|you are now|act as (an?|the)\s|developer mode|jailbreak|pretend (to be|you are)/i;

/** Flags messages that try to instruct the model. The prompt already treats customer text as data; this makes it visible to the agent. */
export function looksLikePromptInjection(text: string): boolean {
  return INJECTION_PATTERN.test(text);
}
