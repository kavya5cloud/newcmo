import type { Metadata } from "next";
import Link from "next/link";
import { allGuides } from "@/lib/guides";
import { SITE_NAME, url } from "@/lib/seo";

// The guides index.
//
// Also the internal-linking hub: every guide links here and here links to every guide, so a
// crawler reaching any one of them reaches all of them. Three orphan pages with no path
// between them get discovered slowly and ranked worse than the same three connected.

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Guides",
  description:
    "Practical guides on marketing without a marketing team — what agencies cost, how to be cited by AI assistants, and why AI writing tools invent statistics.",
  alternates: { canonical: url("/guides") },
  openGraph: {
    type: "website",
    title: `Guides — ${SITE_NAME}`,
    description: "Practical guides on marketing without a marketing team.",
    url: url("/guides"),
    siteName: SITE_NAME,
  },
};

export default function GuidesIndex() {
  const guides = allGuides();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url("/guides")}#collection`,
    name: `Guides — ${SITE_NAME}`,
    url: url("/guides"),
    publisher: { "@id": url("/#organization") },
    hasPart: guides.map((g) => ({
      "@type": "Article",
      headline: g.title,
      description: g.description,
      url: url(`/guides/${g.slug}`),
      datePublished: g.published,
    })),
  };

  return (
    <div className="landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="guide">
        <nav className="g-crumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link> <span aria-hidden="true">/</span> Guides
        </nav>

        <h1>Guides</h1>
        <p className="g-standfirst">
          Written by us, about things we actually did. No generated filler — a company arguing
          that AI content should be grounded in something real should not publish the opposite.
        </p>

        <ul className="g-list">
          {guides.map((g) => (
            <li key={g.slug}>
              <Link href={`/guides/${g.slug}`}>
                <h2>{g.title}</h2>
                <p>{g.description}</p>
                <span className="g-meta">
                  <time dateTime={g.published}>
                    {new Date(g.published).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                  </time>
                  {" · "}{g.readingMinutes} min read
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
