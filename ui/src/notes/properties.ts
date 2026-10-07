/**
 * What each kind of note keeps in its properties, and how to edit it.
 *
 * One declarative table so the form, the scaffold and the readers agree. A
 * field is only ever *offered*; nothing is required, and a blank one is simply
 * absent. Anything read off a website belongs next to `source` and `checked`,
 * which every kind that can be looked up carries.
 */
import type { NoteKind } from './notefile';

export type FieldType = 'text' | 'url' | 'number' | 'date' | 'list' | 'enum' | 'bool' | 'deadlines' | 'uni';

export interface FieldSpec {
  /** Frontmatter key; a dot reaches one level in (`eligibility.max_age`). */
  key: string;
  label: string;
  type: FieldType;
  /** For `enum`. */
  options?: string[];
  /** Under the input, when the field needs a word of explanation. */
  hint?: string;
  placeholder?: string;
  /** Fields with the same group are shown together. */
  group?: string;
}

const SOURCE: FieldSpec[] = [
  { key: 'link', label: 'Page', type: 'url', placeholder: 'https://', group: 'Where this came from' },
  { key: 'source', label: 'Source', type: 'url', placeholder: 'https://', hint: 'The page the figures were read from, when it is not the same one', group: 'Where this came from' },
  { key: 'checked', label: 'Checked', type: 'date', hint: 'Deadlines and money change every cycle; this is how the page knows when to doubt itself', group: 'Where this came from' },
];

export const FIELDS: Partial<Record<NoteKind, FieldSpec[]>> = {
  scholarship: [
    { key: 'provider', label: 'Provider', type: 'text', placeholder: 'DAAD, USIEF, the university…', group: 'What it is' },
    { key: 'countries', label: 'Where it can be used', type: 'list', placeholder: 'DE, US, EU', hint: 'Country codes; leave empty for anywhere', group: 'What it is' },
    { key: 'covers', label: 'Covers', type: 'list', placeholder: 'tuition, living, travel, insurance', group: 'What it is' },
    { key: 'amount', label: 'Amount', type: 'text', placeholder: 'Full · €992 a month · ₹5–10 lakh', group: 'What it is' },
    { key: 'type', label: 'Type', type: 'enum', options: ['grant', 'loan', 'interest-free-loan', 'assistantship', 'fee-waiver'], group: 'What it is' },
    { key: 'route', label: 'How you apply', type: 'enum', options: ['direct', 'via-university', 'via-portal'], group: 'What it is' },
    { key: 'deadlines', label: 'Deadlines', type: 'deadlines', group: 'When' },
    { key: 'eligibility.nationality', label: 'Nationality', type: 'list', placeholder: 'IN', group: 'Who may have it' },
    { key: 'eligibility.min_percent', label: 'Marks floor (%)', type: 'number', placeholder: '60', group: 'Who may have it' },
    { key: 'eligibility.max_age', label: 'Age under', type: 'number', placeholder: '30', group: 'Who may have it' },
    { key: 'eligibility.work_years', label: 'Work experience (years)', type: 'number', placeholder: '3', group: 'Who may have it' },
    { key: 'eligibility.grad_within_years', label: 'Graduated within (years)', type: 'number', placeholder: '6', group: 'Who may have it' },
    { key: 'eligibility.degree_years', label: "Bachelor's length (years)", type: 'number', placeholder: '4', group: 'Who may have it' },
    { key: 'eligibility.fields', label: 'Fields it is limited to', type: 'list', placeholder: 'aerospace, mechanical', group: 'Who may have it' },
    { key: 'eligibility.admission_first', label: 'Needs an admission letter first', type: 'bool', group: 'Who may have it' },
    { key: 'eligibility.note', label: 'Anything else', type: 'text', placeholder: 'Government employees are not eligible', hint: 'Shown as it is, and it always turns the verdict into a Check', group: 'Who may have it' },
    { key: 'status', label: 'Where you are with it', type: 'enum', options: ['', 'applying', 'applied', 'won', 'rejected'], group: 'Who may have it' },
    ...SOURCE,
  ],
  programme: [
    { key: 'uni', label: 'University', type: 'uni', placeholder: 'TU Delft', group: 'What it is' },
    { key: 'programme', label: 'Programme', type: 'text', placeholder: 'MSc Aerospace Engineering', group: 'What it is' },
    { key: 'country', label: 'Country', type: 'text', placeholder: 'NL', group: 'What it is' },
    { key: 'city', label: 'City', type: 'text', group: 'What it is' },
    { key: 'language', label: 'Taught in', type: 'text', placeholder: 'English', group: 'What it is' },
    { key: 'duration_months', label: 'Length (months)', type: 'number', placeholder: '24', group: 'What it is' },
    { key: 'intakes', label: 'Intakes', type: 'list', placeholder: 'fall, winter', group: 'What it is' },
    { key: 'deadlines', label: 'Deadlines', type: 'deadlines', group: 'When' },
    { key: 'tuition', label: 'Tuition', type: 'text', placeholder: '€22,000 a year', group: 'Money' },
    { key: 'tuition_basis', label: 'Tuition figure is', type: 'enum', options: ['official', 'estimated', 'unavailable'], group: 'Money' },
    { key: 'living_cost', label: 'Living cost', type: 'text', placeholder: '€1,100 a month', group: 'Money' },
    { key: 'portal', label: 'Application portal', type: 'url', placeholder: 'https://', group: 'Money' },
    ...SOURCE,
  ],
  person: [
    { key: 'prof', label: 'Name', type: 'text', placeholder: 'Prof. A. Verma', group: 'Who' },
    { key: 'uni', label: 'University', type: 'uni', group: 'Who' },
    { key: 'lab', label: 'Lab or group', type: 'text', group: 'Who' },
    { key: 'topics', label: 'Topics', type: 'list', placeholder: 'composites, propulsion', group: 'Who' },
    { key: 'emailed', label: 'Emailed', type: 'date', group: 'The thread' },
    { key: 'replied', label: 'Replied', type: 'date', group: 'The thread' },
    { key: 'followup', label: 'Follow up on', type: 'date', group: 'The thread' },
    { key: 'link', label: 'Page', type: 'url', placeholder: 'https://', group: 'The thread' },
  ],
  profile: [
    { key: 'nationality', label: 'Nationality', type: 'text', placeholder: 'IN', group: 'You' },
    { key: 'cgpa', label: 'CGPA', type: 'number', placeholder: '9.1', group: 'You' },
    { key: 'cgpa_scale', label: 'On a scale of', type: 'number', placeholder: '10', group: 'You' },
    { key: 'graduation', label: 'Graduating', type: 'number', placeholder: '2026', group: 'You' },
    { key: 'degree_years', label: "Bachelor's length (years)", type: 'number', placeholder: '4', group: 'You' },
    { key: 'age', label: 'Age', type: 'number', hint: 'Several Indian scholarships cap at 30', group: 'You' },
    { key: 'work_years', label: 'Full-time work (years)', type: 'number', placeholder: '0', group: 'You' },
    { key: 'fields', label: 'Fields', type: 'list', placeholder: 'aerospace, mechanical', group: 'What you want' },
    { key: 'topics', label: 'Topics', type: 'list', placeholder: 'composite materials, rocket propulsion', group: 'What you want' },
    { key: 'countries', label: 'Countries in play', type: 'list', placeholder: 'DE, US, CA, GB, NL', group: 'What you want' },
    { key: 'budget_inr', label: 'Budget ceiling (₹)', type: 'number', placeholder: '2500000', group: 'Money' },
    { key: 'loan_inr', label: 'Loan appetite (₹)', type: 'number', placeholder: '2000000', group: 'Money' },
  ],
};

/** The groups of a kind's fields, in the order they were declared. */
export function groupsOf(specs: FieldSpec[]): { name: string; fields: FieldSpec[] }[] {
  const out: { name: string; fields: FieldSpec[] }[] = [];
  for (const f of specs) {
    const name = f.group ?? '';
    const last = out[out.length - 1];
    if (last && last.name === name) last.fields.push(f);
    else out.push({ name, fields: [f] });
  }
  return out;
}

/** A value from the note's properties, following a dotted key. */
export function valueAt(data: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' && !Array.isArray(acc) ? (acc as Record<string, unknown>)[part] : undefined), data);
}
