/**
 * A task's title, split where it says what to do.
 *
 * "Pay the water bill" reads as an action: the verb is the button, the rest is
 * the sentence. A title that does not open with a verb from this list is left
 * whole, and its button is a tick.
 */
const VERBS = new Set(
  `add apply approve arrange ask attend back backup book bring build buy call cancel change check choose clean clear close collect compare complete confirm contact copy create cut decide deliver design download draft email export file fill find finish fix follow get give install invite join learn list log make meet merge message move order organise organize pack pay pick plan post practise practice prepare print publish read record refill register remove renew reply request research reserve return review run save scan schedule send set setup share ship shortlist sign sort start study submit sync talk test text tidy track transfer try update upload verify visit wash watch water withdraw write`.split(
    ' ',
  ),
);

export function splitVerb(title: string): { verb?: string; rest: string } {
  const text = title.trim();
  const gap = text.indexOf(' ');
  if (gap < 2) return { rest: text };
  const first = text.slice(0, gap);
  if (!VERBS.has(first.toLowerCase())) return { rest: text };
  return { verb: first[0].toUpperCase() + first.slice(1), rest: text.slice(gap + 1).trim() };
}
