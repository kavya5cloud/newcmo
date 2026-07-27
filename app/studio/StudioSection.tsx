import { CATEGORY_META, kindsForCategory, type CreativeCategory } from "@/lib/creative/taxonomy";
import type { ContentFormat } from "@/lib/content/compose";
import GenerateButton from "./GenerateButton";
import Composer from "./Composer";

// Shared scaffold for every studio section. Sections whose job is writing lead with the
// Composer; every asset kind generates through the Job Engine. The "Soon" badges are gone
// because the work behind them is done — a disabled-looking card next to a working button
// was the worst of both.

const COMPOSER_FORMAT: Partial<Record<CreativeCategory, ContentFormat>> = {
  documents: "blog",
  ads: "post",
  launch: "announcement",
  library: "post",
};

export default function StudioSection({ category }: { category: CreativeCategory }) {
  const meta = CATEGORY_META[category];
  const kinds = kindsForCategory(category);
  const composerFormat = COMPOSER_FORMAT[category];

  return (
    <section className="st-section">
      <header className="st-shead">
        <span className="label">{meta.label}</span>
        <h1>{meta.label}</h1>
        <p>{meta.blurb}</p>
      </header>

      {composerFormat && <Composer initialFormat={composerFormat} />}

      {kinds.length === 0 ? (
        <div className="st-empty">
          <p>This space is being prepared. Assets you generate will appear here.</p>
        </div>
      ) : (
        <>
          {composerFormat && <h3 className="lw-h2 cmp-h3">Or start from an asset type</h3>}
          <div className="st-grid">
            {kinds.map((k) => (
              <article key={k.kind} className="st-card">
                <div className="st-card-top">
                  <span className="st-card-kind">{k.label}</span>
                </div>
                <p className="st-card-meta">{k.channel} · effort {k.effort}/5{k.foundational ? " · foundational" : ""}</p>
                <GenerateButton category={category} label={k.label} />
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
