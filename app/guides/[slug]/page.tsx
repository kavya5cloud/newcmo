import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allGuides, guideBySlug, type Block, type Guide } from "@/lib/guides";
import { SITE_NAME, url } from "@/lib/seo";

// One guide.
//
// Statically generated from lib/guides.ts — there is no CMS and no database read, so these
// are plain HTML on the edge, which is both the fastest thing to serve and the easiest thing
// for a crawler to parse.
//
// Three structured-data blocks per page: Article so the piece is understood as editorial,
// BreadcrumbList so the hierarchy shows in results, and FAQPage where the guide answers real
// questions. Nothing is asserted that the visible page does not also say — markup that
// disagrees with the page is a manual action waiting to happen, not a rich result.

export const dynamic = "force-static";

export function generateStaticParams() {
  return allGuides().map((g) => ({ slug: g.slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) return { title: "Not found" };

  const canonical = url(`/guides/${guide.slug}`);
  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      title: guide.title,
      description: guide.description,
      url: canonical,
      siteName: SITE_NAME,
      publishedTime: guide.published,
      modifiedTime: guide.updated,
    },
    twitter: { card: "summary_large_image", title: guide.title, description: guide.description },
  };
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h2": return <h2 key={i}>{b.text}</h2>;
          case "h3": return <h3 key={i}>{b.text}</h3>;
          case "p": return <p key={i}>{b.text}</p>;
          case "quote": return <blockquote key={i}>{b.text}</blockquote>;
          case "code": return <pre key={i}><code>{b.text}</code></pre>;
          case "ul": return <ul key={i}>{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>;
          case "ol": return <ol key={i}>{b.items.map((it, j) => <li key={j}>{it}</li>)}</ol>;
          case "table":
            return (
              // Wrapped because a wide table must scroll inside itself rather than making
              // the whole page scroll sideways on a phone.
              <div className="g-tablewrap" key={i}>
                <table>
                  <thead><tr>{b.head.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
                  <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            );
        }
      })}
    </>
  );
}

function structuredData(guide: Guide) {
  const canonical = url(`/guides/${guide.slug}`);
  const graph: Record<string, unknown>[] = [
    {
      "@type": "Article",
      "@id": `${canonical}#article`,
      headline: guide.title,
      description: guide.description,
      datePublished: guide.published,
      dateModified: guide.updated,
      inLanguage: "en",
      mainEntityOfPage: canonical,
      author: { "@id": url("/#organization") },
      publisher: { "@id": url("/#organization") },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumbs`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: url("/") },
        { "@type": "ListItem", position: 2, name: "Guides", item: url("/guides") },
        { "@type": "ListItem", position: 3, name: guide.title, item: canonical },
      ],
    },
  ];

  // Only when the page visibly answers these questions — see the FAQ section below.
  if (guide.faq?.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${canonical}#faq`,
      mainEntity: guide.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) notFound();

  const others = allGuides().filter((g) => g.slug !== guide.slug).slice(0, 2);

  return (
    <div className="landing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(guide)) }}
      />
      <article className="guide">
        <nav className="g-crumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link> <span aria-hidden="true">/</span> <Link href="/guides">Guides</Link>
        </nav>

        <h1>{guide.title}</h1>
        <p className="g-standfirst">{guide.description}</p>
        <p className="g-meta">
          <time dateTime={guide.published}>
            {new Date(guide.published).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </time>
          {" · "}{guide.readingMinutes} min read
        </p>

        <div className="g-body">
          <Blocks blocks={guide.blocks} />

          {guide.faq?.length ? (
            <>
              <h2>Common questions</h2>
              {/* Rendered, not just marked up. FAQ structured data describing questions a
                  visitor cannot see on the page is exactly what Google penalises. */}
              {guide.faq.map((f, i) => (
                <div className="g-faq" key={i}>
                  <h3>{f.q}</h3>
                  <p>{f.a}</p>
                </div>
              ))}
            </>
          ) : null}
        </div>

        <aside className="g-next">
          <h2>Read next</h2>
          <ul>
            {others.map((g) => (
              <li key={g.slug}>
                <Link href={`/guides/${g.slug}`}>{g.title}</Link>
                <span>{g.description}</span>
              </li>
            ))}
          </ul>
        </aside>

        <div className="g-cta">
          <p>Populr is an AI CMO for founders without a marketing hire. Paste your website and it builds the plan.</p>
          <Link className="btn" href="/app">Try it free for a month</Link>
        </div>
      </article>
    </div>
  );
}
