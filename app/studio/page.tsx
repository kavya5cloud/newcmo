import Link from "next/link";

const FORMATS = [
  ["Slideshow", "Multi-image carousel with captions", "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=900&q=85", "/studio/images"],
  ["Wall of Text", "Bold text on a plain background", "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=85", "/studio/documents"],
  ["Video Hook & Demo", "Hook clip + app demo stitched together", "https://images.unsplash.com/photo-1551650975-87deedd944c3?auto=format&fit=crop&w=900&q=85", "/studio/videos"],
  ["Talking Head UGC", "AI avatar speaks a script to camera", "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=900&q=85", "/studio/ugc"],
  ["Green Screen Meme", "Trending video with your background", "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=85", "/studio/videos"],
  ["Talking Head Green Screen", "AI avatar composited into your creative", "https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=900&q=85", "/studio/ugc"],
  ["Product Spokesperson", "A character holds your product and talks", "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=85", "/studio/ugc"],
  ["Green Screen Mobile with App", "A presenter holding a phone with your app", "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=900&q=85", "/studio/videos"],
] as const;

// Creative Studio overview. Entry point into the section navigation. Generation is
// not wired yet — every launch flows through Mission → Campaign → Brief → Planner →
// Director → Council before any asset is produced.
export default function StudioHome() {
  return (
    <section className="content-gallery">
      <header className="content-gallery-head">
        <span className="blitz-eyebrow">AI Studio</span>
        <h1>Create new content</h1>
        <p>Pick a format to get started. You can switch anytime.</p>
      </header>
      <div className="content-format-grid">
        {FORMATS.map(([title, description, image, href]) => (
          <Link key={title} href={href} className="content-format-card">
            <div className="content-format-image" style={{ backgroundImage: `url(${image})` }} />
            <div className="content-format-copy"><h2>{title}</h2><p>{description}</p></div>
          </Link>
        ))}
      </div>
    </section>
  );
}
