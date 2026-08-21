import type { NewReference } from "./types";

// The starting corpus.
//
// Small on purpose, and worth saying why rather than letting the number look like a
// shortfall. Every row here is written by us, claims no statistic, and cites nothing,
// because a seeded corpus is exactly where a fabricated citation would do the most damage:
// written once, read into every prompt, and repeated back to customers as research. Rows
// that assert numbers have to come from somewhere real, and `assertCitable` refuses them
// otherwise — including ours.
//
// So the corpus grows by ingestion, not by authorship. This is the scaffold that makes the
// layer non-empty on day one and demonstrates the shape an ingested row takes.
//
// Deliberately NOT a copy of lib/content/craft.ts. That file already owns general writing
// craft — openings, shapes, bans, per-platform form — and it reaches the prompt on every
// generation. Restating it here would put the same instruction in the context twice and
// leave two places to change it. These are the things craft.ts does not cover: structure
// that is specific to a channel, and the shape of a campaign rather than a sentence.

const ours = (observedAt: number | null = null): NewReference["source"] => ({
  name: "Populr",
  url: null,
  licence: "original",
  observedAt,
});

const principle = (
  pattern: string,
  evidence: string,
  channel: NewReference["channel"],
  tags: string[],
): NewReference => ({
  kind: "principle",
  workspaceKey: null,
  pattern,
  evidence,
  excerpt: null,
  metrics: [],
  source: ours(),
  channel,
  industry: null,
  audience: null,
  tags,
});

export const SEED: NewReference[] = [
  // ---- Paid social ----
  principle(
    "An ad has to make sense with the sound off and the copy unread",
    "The image or first frame carries the offer on its own; the copy is read only by someone the visual already stopped.",
    "ads", ["hook", "creative", "visual"],
  ),
  principle(
    "Name the problem before naming the product",
    "A viewer who does not recognise the problem has no reason to read what solves it, and the product name answers a question they have not asked yet.",
    "ads", ["hook", "positioning"],
  ),
  principle(
    "One ad, one claim",
    "A creative arguing three benefits is remembered for none. The second claim is a second ad.",
    "ads", ["structure", "clarity"],
  ),

  // ---- Email ----
  principle(
    "The subject line promises exactly what the first sentence delivers",
    "A subject that oversells is opened once and trains the reader to skip the next one. Continuity between subject and opener is what protects the second send.",
    "email", ["subject", "trust"],
  ),
  principle(
    "One thing to do, said once, near the top",
    "An email with a link in every paragraph reads as a page. The reader's decision is easier when there is exactly one thing to decide.",
    "email", ["cta", "structure"],
  ),
  principle(
    "Write the email to one person, not to a list",
    "Plural address — everyone, teams, businesses like yours — tells the reader it was not written for them, which is the reason they will not answer.",
    "email", ["voice", "b2b"],
  ),

  // ---- Organic social ----
  principle(
    "A post that could have been written by any company in the category will be ignored by all of it",
    "Specificity is the only thing that cannot be copied: a real number, a named decision, a thing that broke on a Tuesday.",
    null, ["hook", "differentiation"],
  ),
  principle(
    "Publishing on a schedule beats publishing when inspired",
    "Consistency is what compounds; volume without it is noise. A schedule also removes the decision that stops most posts from being written.",
    null, ["cadence", "playbook"],
  ),

  // ---- Playbooks ----
  {
    kind: "playbook",
    workspaceKey: null,
    pattern: "Launch to the people who already said yes before launching to strangers",
    evidence: "Existing users, waitlist and anyone who replied to a previous post are the audience most likely to act, and their response is what makes the public launch look worth attending to.",
    excerpt: null,
    metrics: [],
    source: ours(),
    channel: null,
    industry: null,
    audience: null,
    tags: ["launch", "sequence", "playbook"],
  },
  {
    kind: "playbook",
    workspaceKey: null,
    pattern: "Write the announcement before building the thing",
    evidence: "An announcement that is hard to write is describing a change that is hard to care about. Finding that out before the work is cheaper than after.",
    excerpt: null,
    metrics: [],
    source: ours(),
    channel: null,
    industry: null,
    audience: null,
    tags: ["launch", "positioning", "playbook"],
  },

  // ---- Brand ----
  {
    kind: "brand",
    workspaceKey: null,
    pattern: "A brand voice is a set of refusals, not a set of adjectives",
    evidence: "\"Friendly, bold, human\" describes every brand and constrains nothing. What a company will not say is what makes it recognisable in one sentence.",
    excerpt: null,
    metrics: [],
    source: ours(),
    channel: null,
    industry: null,
    audience: null,
    tags: ["voice", "brand", "positioning"],
  },
];
