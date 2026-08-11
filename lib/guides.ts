// The guides.
//
// Populr had five indexable URLs, two of which were legal pages. The technical SEO was
// clean — canonicals, sitemap, robots, structured data all correct — and had nothing to
// rank. A search engine cannot send traffic to pages that do not exist.
//
// These are written, not generated. That is a deliberate line: this product's whole
// argument is that AI content should be grounded in something real, and a site that
// publishes generated filler about generated filler would be arguing against itself. Every
// guide here is about something we actually did or actually know.
//
// Content is typed data rather than MDX because the dependency list is short on purpose and
// a markdown pipeline is not worth a build step for a handful of pages.

export type Block =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

export type Guide = {
  slug: string;
  /** Under 60 characters where possible — longer gets truncated in results. */
  title: string;
  /** 140–160 characters. This is the snippet, so it is a promise, not a summary. */
  description: string;
  /** The question this page answers, in the words someone would type. */
  intent: string;
  published: string;   // ISO date
  updated: string;
  readingMinutes: number;
  blocks: Block[];
  /** Rendered into FAQPage structured data. Real questions with real answers only. */
  faq?: { q: string; a: string }[];
};

const p = (text: string): Block => ({ kind: "p", text });
const h2 = (text: string): Block => ({ kind: "h2", text });
const h3 = (text: string): Block => ({ kind: "h3", text });
const ul = (items: string[]): Block => ({ kind: "ul", items });
const ol = (items: string[]): Block => ({ kind: "ol", items });
const quote = (text: string): Block => ({ kind: "quote", text });
const table = (head: string[], rows: string[][]): Block => ({ kind: "table", head, rows });

export const GUIDES: Guide[] = [
  {
    slug: "ai-cmo-vs-marketing-agency",
    title: "AI CMO vs marketing agency: the real numbers",
    description:
      "What a marketing agency, a first marketing hire, and an AI CMO actually cost a startup — and the specific work each one is genuinely better at.",
    intent: "should I hire a marketing agency or use an AI marketing tool",
    published: "2026-08-10",
    updated: "2026-08-10",
    readingMinutes: 6,
    blocks: [
      p("Most comparisons of this kind are written by whoever is selling one of the options. This one is too — we build an AI CMO. So here is the part that usually gets left out: there is work an agency does that no AI tool can do today, and if that is the work you need, the price comparison is irrelevant."),
      p("What follows is the actual arithmetic, then the honest boundary."),

      h2("What each one costs"),
      p("Figures are typical ranges for early-stage B2B software companies. Your market will vary; the shape does not."),
      table(
        ["Option", "Typical monthly cost", "What you get"],
        [
          ["Full-service agency", "$4,000–$10,000", "Strategy, content, paid media, reporting. A team, but rarely senior attention on a small account."],
          ["Freelance marketer", "$1,500–$4,000", "One person, part-time, usually strong in one channel and thin elsewhere."],
          ["First marketing hire", "$5,000–$9,000 plus equity", "Full-time ownership. Three to six months before output compounds."],
          ["AI CMO tooling", "$15–$200", "Strategy and content generated and scheduled. No judgement about your market that you did not supply."],
        ],
      ),
      p("The gap is two orders of magnitude, which is why the comparison gets made at all. But cost per month is the wrong denominator. The right one is cost per decision that turns out to be correct."),

      h2("What an agency is genuinely better at"),
      p("Being specific about this is more useful than pretending otherwise."),
      ul([
        "Relationships. A publicist who knows an editor personally is not a capability you can buy in software.",
        "Paid media at scale. Once you are spending real money on ads, an experienced buyer earns their fee in avoided waste.",
        "Taste under uncertainty. Deciding that a category is about to shift, and betting the positioning on it, is judgement — and judgement is exactly what a language model does not have.",
        "Accountability. You can fire an agency. You cannot fire a tool, and it will never tell you your idea is bad.",
      ]),

      h2("What software is genuinely better at"),
      ul([
        "Consistency. The fourth month looks like the first. Agencies front-load their best people onto new accounts and quietly rotate them off.",
        "Volume at low stakes. Twenty variations of a post, every day, costs nothing and needs no meeting.",
        "Memory. Every decision, every outcome, in one place, permanently — rather than in a shared drive someone leaves behind.",
        "Speed. Something written and scheduled in ten minutes rather than in a Thursday review cycle.",
      ]),

      h2("The honest decision rule"),
      p("If you do not yet know who your buyer is or what makes you different, no amount of content helps. That is a positioning problem, and it is solved by talking to customers — not by an agency and not by a tool. Spend the month on interviews instead."),
      p("If you know your positioning and simply are not shipping, that is a throughput problem, and it is the one software actually solves."),
      p("If you are spending more than about $10,000 a month on paid acquisition, hire the human. The fee is small relative to what a bad media buy costs you."),

      h2("What we would not claim"),
      p("An AI CMO does not know your market. It knows what you told it and what it can read on your site. It will produce a competent post about a strategy you chose, and it will produce an equally competent post about a bad strategy you chose, with no change in tone to warn you. That is the real limitation, and it is not one that a better model fixes."),
    ],
    faq: [
      {
        q: "Is an AI CMO a replacement for a marketing agency?",
        a: "For content production and scheduling, largely yes. For paid media at scale, press relationships, and positioning judgement, no. The practical split is that software handles throughput and an experienced human handles bets that are expensive to get wrong.",
      },
      {
        q: "How much does a marketing agency cost for a startup?",
        a: "Full-service agencies typically run $4,000–$10,000 a month for early-stage B2B software, and freelancers $1,500–$4,000. A first in-house marketing hire is usually $5,000–$9,000 a month plus equity.",
      },
      {
        q: "When should a startup hire a marketer instead of using software?",
        a: "When the bottleneck is judgement rather than throughput — unclear positioning, a category shift, or paid spend above roughly $10,000 a month, where an experienced buyer's fee is small against the cost of a bad media buy.",
      },
    ],
  },

  {
    slug: "what-is-geo-generative-engine-optimization",
    title: "What is GEO? Getting named by AI assistants",
    description:
      "Generative Engine Optimization is getting cited when someone asks ChatGPT or Claude what to use. How it differs from SEO, and how to measure whether you appear at all.",
    intent: "what is generative engine optimization and how do I rank in AI answers",
    published: "2026-08-10",
    updated: "2026-08-10",
    readingMinutes: 7,
    blocks: [
      p("A growing share of buyers no longer open ten blue links. They ask an assistant what to use and act on the answer. If your product is not named in that answer, you were not in the running — and unlike a search result, there is no page two to be on."),
      p("Generative Engine Optimization is the work of being named. It overlaps with SEO, but the thing being optimised for is different, and so is the way you check whether it worked."),

      h2("How it differs from SEO"),
      table(
        ["", "SEO", "GEO"],
        [
          ["Goal", "Rank in a list of links", "Be named inside an answer"],
          ["Unit of success", "Position for a keyword", "Whether you are mentioned, and how"],
          ["Rewards", "Depth, authority, backlinks", "Being quotable and unambiguous"],
          ["Feedback", "Search Console, daily", "No dashboard exists — you have to ask"],
        ],
      ),
      p("The last row is the one that catches people. There is no Search Console for AI answers. Nobody sends you a report saying you were mentioned in four thousand conversations last month. If you want to know, you have to ask the models yourself, repeatedly, and record what came back."),

      h2("What actually makes a product citable"),
      p("Models reach for things they can state without hedging. That has practical consequences for how a page is written."),
      ul([
        "A one-sentence definition on the page. If a model has to infer what you are, it will reach for something it can describe in one line instead.",
        "An explicit category and differentiator. \"An AI CMO for founders without a marketing hire\" is quotable. \"A growth platform\" is not.",
        "Comparison tables. A model asked to compare options will lift a structured comparison almost verbatim.",
        "Real numbers and dates. Specifics get cited; adjectives get paraphrased into nothing.",
        "FAQ markup answering what a buyer asks before trusting you.",
      ]),
      p("Notice that none of this is a trick. It is the same thing that makes a page useful to a person in a hurry, which is roughly what a model is."),

      h2("How to measure it"),
      p("The measurement is simple to describe and easy to get wrong in one specific way."),
      ol([
        "Write the questions a buyer would actually type — \"what is the best X for Y\", not \"tell me about your brand\".",
        "Ask a model each one, in a fresh context, with no mention of your company.",
        "Record whether your name appears, and which products appeared instead.",
        "Repeat on a schedule, because the answer changes as models are retrained.",
      ]),
      quote("The query must never contain your brand name. Ask a model about your company and it will describe your company — whether or not it has ever heard of you. That question always returns good news, which is exactly why it is worthless."),
      p("The names that appear instead of yours are the useful output. They are who the model currently reaches for in your category, which tells you what you are actually competing against in that channel."),

      h2("What GEO cannot do"),
      p("Model weights are not a search index. You cannot submit a page and appear tomorrow. Changes propagate when models retrain, on a timescale you do not control and nobody publishes. Anyone selling guaranteed AI-answer placement is selling something that does not exist."),
      p("What you can control is whether, when a model does encounter your page, there is a clear sentence to quote — and whether you know your current position well enough to tell if it moves."),
    ],
    faq: [
      {
        q: "What does GEO stand for?",
        a: "Generative Engine Optimization — the practice of getting a product cited inside AI assistant answers, rather than ranked in a list of search results.",
      },
      {
        q: "Is GEO different from SEO?",
        a: "They overlap but optimise for different things. SEO rewards depth, authority and links to earn a position in a list. GEO rewards being quotable and unambiguous so a model can name you inside an answer. GEO also has no equivalent of Search Console, so visibility has to be measured by asking models directly.",
      },
      {
        q: "How do I check whether ChatGPT mentions my company?",
        a: "Ask it the questions a buyer would type about your category — never naming your company — and record whether you appear and which competitors do. Repeat on a schedule, since answers change as models are retrained. A query that names your brand always returns a mention and measures nothing.",
      },
    ],
  },

  {
    slug: "why-ai-marketing-tools-invent-statistics",
    title: "Why AI marketing tools invent statistics",
    description:
      "Our own AI wrote a statistic that does not exist. Why every AI writing tool does this, why it is hard to notice, and the specific checks that stop it.",
    intent: "why does AI make up statistics and how do I stop it",
    published: "2026-08-10",
    updated: "2026-08-10",
    readingMinutes: 5,
    blocks: [
      p("Last week our own product wrote this for a customer:"),
      quote("Did you know that Europeans are 2.5x more likely to engage with content that's relevant to their interests?"),
      p("There is no such study. The number does not exist. It was one click from being published under someone else's name."),
      p("We build AI marketing software, and we are describing our own failure, because the alternative — everyone in this category quietly patching this and saying nothing — is worse for the people buying it."),

      h2("The number is fake. It is also meaningless."),
      p("Read it again. Europeans are more likely to engage with content relevant to their interests. Compared to what? Content irrelevant to their interests? Everyone on earth engages more with things they care about. It is a tautology wearing a lab coat."),
      p("That is what makes it dangerous. It is not a wild hallucination anyone would catch. It sounds like something you read once, it has a decimal point in it, and it survives a skim. A founder pastes it into a deck, an investor asks for the source, and the problem is now theirs."),

      h2("Why models do this"),
      p("A language model predicts plausible continuations. In marketing prose, a persuasive claim is very often followed by a supporting statistic — so when you ask for persuasive copy, a statistic is the statistically likely next thing, and one gets produced. The model is not lying. It has no concept of a citation to omit."),
      p("Which means prompting alone cannot fix it. \"Be accurate\" competes against the pattern; it does not remove it."),

      h2("What actually stops it"),
      p("Three things, in increasing order of how much they help."),
      h3("1. Name the shape, not the principle"),
      p("\"Do not invent statistics\" gets ignored. \"Never write '2.5x more likely', '68% of buyers', or 'studies show'\" gets matched, because it gives the model a concrete pattern to avoid rather than an abstraction to interpret."),
      h3("2. Put the rule everywhere, once"),
      p("We had this rule. It lived in the conversational path and not in the three paths that write the posts customers actually publish — so it covered chat and not content, which is exactly backwards. One shared module, imported by every prompt builder, is the fix. If a rule lives in one of four places, it does not exist."),
      h3("3. Check the output, do not just ask nicely"),
      p("A prompt is a request. A deterministic check is a contract. Scanning finished text for unsourced-claim patterns costs nothing, cannot be talked out of it, and catches what the prompt missed. Asking a second model to grade the first does not count — that is the same system marking its own homework, and it fails quietly when the grader is agreeable."),

      h2("How to test the tool you are using"),
      p("Ask it to write a persuasive post about a topic it has no data on. Then ask where each number came from. A tool worth using will either cite something you provided or will have written the argument without a number at all. Most will produce a figure and, when pressed, produce a plausible source for it too."),
      p("If your AI writing tool has never once told you it does not know enough to answer, it is not being confident. It is being unfalsifiable."),
    ],
    faq: [
      {
        q: "Why does AI make up statistics?",
        a: "A language model predicts plausible continuations. In persuasive marketing prose, a claim is usually followed by a supporting figure, so asking for persuasive copy makes a statistic the likely next thing — and one gets produced. There is no citation being omitted, because there was never a source.",
      },
      {
        q: "Can prompting stop AI from inventing data?",
        a: "Only partly. Vague instructions like \"be accurate\" compete with the pattern rather than removing it. Naming concrete shapes — \"never write '68% of buyers' or 'studies show'\" — works better, and a deterministic check on the finished text is what actually enforces it.",
      },
      {
        q: "How do I check whether an AI tool is fabricating figures?",
        a: "Ask it to write persuasively about something it has no data on, then ask where each number came from. A trustworthy tool either cites data you supplied or makes the argument without a figure. Be wary of one that produces both a statistic and, on request, a plausible-sounding source for it.",
      },
    ],
  },
];

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

/** Newest first, for the index and the sitemap. */
export function allGuides(): Guide[] {
  return [...GUIDES].sort((a, b) => b.published.localeCompare(a.published));
}
