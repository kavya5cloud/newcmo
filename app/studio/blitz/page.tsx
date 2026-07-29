"use client";

import { useState } from "react";

type UGCItem = {
  id: string;
  title: string;
  text: string;
  image: string;
  channel: string;
  creator: string;
  reason: string;
  stats: string;
};

const INITIAL: UGCItem[] = [
  {
    id: "blitz-1", title: "Founder proof", channel: "Short video", creator: "Maya · Founder",
    text: "Tried juggling SEO, content, and socials today. 20 tasks on my list. 15 didn’t get done. But Populr handled the rest. Campaigns launched, posts scheduled, leads coming in.",
    image: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=900&q=85",
    reason: "This leads with a relatable pain, then shows the product as the operational payoff. It is short enough to hold attention and ends on a concrete outcome.", stats: "4.3K likes · 110.1K views",
  },
  {
    id: "blitz-2", title: "Outbound result", channel: "Short video", creator: "Nia · Power user",
    text: "Emailed 200 brands today. 58 replied. 46 said no. But 4 said yes. Those 4 paid me $1,000 each. That’s $4,000 in one day.",
    image: "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=900&q=85",
    reason: "The numbers create a fast open loop. The final line gives the audience a measurable result without asking them to understand a complex feature.", stats: "2.8K likes · 72.4K views",
  },
  {
    id: "blitz-3", title: "The simple system", channel: "Carousel", creator: "Alex · Practitioner",
    text: "One mission. Every channel. A content system that keeps moving when your task list does not.",
    image: "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=900&q=85",
    reason: "This is the clearest product narrative in the queue: one input becomes a repeatable marketing system. It balances clarity with a useful amount of curiosity.", stats: "Recommended · high clarity",
  },
];

async function downloadAsset(item: UGCItem) {
  try {
    const response = await fetch(item.image);
    if (!response.ok) throw new Error("download failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jpg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch {
    window.open(item.image, "_blank", "noopener,noreferrer");
  }
}

export default function BlitzPage() {
  const [items, setItems] = useState(INITIAL);
  const [why, setWhy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function decide(id: string) {
    setItems((all) => all.filter((item) => item.id !== id));
    setEditing(null);
  }

  function updateText(id: string, text: string) {
    setItems((all) => all.map((item) => item.id === id ? { ...item, text } : item));
  }

  return (
    <div className="blitz-page">
      <div className="blitz-trial"><span>◷</span><strong>Free trial</strong><span>· 6d 23h left</span><button>Upgrade</button></div>
      <main className="blitz-workspace">
        <div className="blitz-top">
          <div><span className="blitz-eyebrow">Blitz · UGC content library</span><h1>Scroll through your content. Download what is ready.</h1><p>Review creator content in one place, make quick edits, and download the approved UGC for your client or campaign.</p></div>
          <button className="blitz-config">⚙ Configure <i /></button>
        </div>

        <div className="blitz-toolbar"><div className="blitz-tabs"><button className="on">UGC Feed</button><button className={why ? "on" : ""} onClick={() => setWhy((v) => !v)}>♧ Why This Content?</button></div><span>{items.length} pieces ready</span></div>

        <section className="blitz-feed" aria-label="UGC content feed">
          {items.map((item) => {
            const isEditing = editing === item.id;
            const text = drafts[item.id] ?? item.text;
            return (
              <article className="blitz-feed-item" key={item.id}>
                <div className="blitz-feed-copy">
                  <div className="blitz-card-head"><span>{item.title}</span><small>{item.channel}</small></div>
                  <div className="blitz-copy-media" style={{ backgroundImage: `url(${item.image})` }}><p>{item.text}</p></div>
                  <div className="blitz-card-foot"><span>{item.creator}</span><span>{item.stats}</span></div>
                </div>
                <div className="blitz-feed-detail">
                  <div className="blitz-feed-label">CLIENT UGC · READY FOR REVIEW</div>
                  <h2>{item.title}</h2>
                  <p className="blitz-feed-description">{item.text}</p>
                  <div className="blitz-feed-meta"><span>✓ Original asset</span><span>▣ {item.channel}</span><span>↗ Client-ready</span></div>
                  {why && <div className="blitz-why"><strong>Why this content?</strong><span>{item.reason}</span></div>}
                  {isEditing && <div className="blitz-editor"><label htmlFor={`blitz-edit-${item.id}`}>Edit this content</label><textarea id={`blitz-edit-${item.id}`} value={text} onChange={(e) => setDrafts((all) => ({ ...all, [item.id]: e.target.value }))} /><button onClick={() => { updateText(item.id, text); setEditing(null); }}>Done editing</button></div>}
                  <div className="blitz-feed-actions"><button className="blitz-download" onClick={() => downloadAsset(item)}>↓ Download</button><button className="blitz-feed-edit" onClick={() => { setEditing(isEditing ? null : item.id); setDrafts((all) => ({ ...all, [item.id]: item.text })); }}>✎ {isEditing ? "Close" : "Edit"}</button><button className="blitz-feed-reject" onClick={() => decide(item.id)}>× Reject</button><button className="blitz-feed-approve" onClick={() => decide(item.id)}>✓ Approve</button></div>
                </div>
              </article>
            );
          })}
        </section>
        {!items.length && <div className="blitz-empty"><strong>Queue cleared.</strong><span>New UGC will appear here when the next campaign pass is ready.</span><button onClick={() => setItems(INITIAL)}>Reload sample queue</button></div>}
      </main>
      <div className="blitz-help"><span>What can I help you with?</span><button>×</button></div><button className="blitz-chat" aria-label="Open assistant">◒</button>
    </div>
  );
}
