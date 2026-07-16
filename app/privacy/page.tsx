import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Populr",
  description: "How Populr collects, uses, and protects your data.",
};

export default function Privacy() {
  return (
    <div className="legal">
      <div className="legal-top">
        <a href="/">← Populr</a>
        <span className="legal-wordmark">Populr.</span>
      </div>

      <h1>Privacy Policy</h1>
      <div className="updated">Last updated: 13 July 2026</div>

      <p>
        This Privacy Policy explains how Populr (&quot;Populr&quot;, &quot;we&quot;, &quot;us&quot;) collects, uses, and protects
        information when you use our website and application (the &quot;Service&quot;). By using the Service you agree to
        this policy.
      </p>

      <h2>1. Information we collect</h2>
      <ul>
        <li><strong>Account information</strong> — your email address and a securely hashed version of your password.</li>
        <li><strong>Usage data</strong> — the website URLs you ask us to analyze, the marketing content generated for you, chat messages you send to the AI CMO, and your workspace state.</li>
        <li><strong>Google Search Console data</strong> — only if you choose to connect it: read-only access to your Search Console metrics (impressions, clicks, click-through rate, average position, and top queries) and the list of sites you have verified.</li>
        <li><strong>Technical data</strong> — standard request and log information needed to operate and secure the Service.</li>
      </ul>

      <h2>2. How we use information</h2>
      <ul>
        <li>To provide the Service — analyze the sites you submit, generate marketing recommendations and drafts, and display your analytics.</li>
        <li>To create and secure your account and keep you signed in.</li>
        <li>To operate, maintain, and improve the Service.</li>
      </ul>

      <h2>3. Google API Services User Data</h2>
      <p>
        Populr&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. Specifically:
      </p>
      <ul>
        <li>We access your Google Search Console data solely to display your search-performance analytics inside the app, at your request.</li>
        <li>We do <strong>not</strong> sell this data, use it for advertising, or use it to train generalized AI/ML models.</li>
        <li>We do <strong>not</strong> transfer this data to others except as necessary to provide the feature, comply with the law, or with your explicit consent.</li>
        <li>Your Google Search Console data is <strong>not</strong> sent to our third-party AI providers.</li>
        <li>You can revoke our access at any time by disconnecting Search Console in your account settings, or via your{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Google Account permissions</a>.
        </li>
      </ul>

      <h2>4. Third-party services</h2>
      <p>We rely on a small number of processors to run the Service:</p>
      <ul>
        <li><strong>AI providers (Groq, and optionally OpenAI)</strong> — the site content and prompts you submit are sent to these providers to generate analysis and drafts.</li>
        <li><strong>Neon</strong> — our database, where your account and workspace data are stored.</li>
        <li><strong>Vercel</strong> — application hosting.</li>
        <li><strong>Google</strong> — Search Console data, only if you connect it.</li>
      </ul>

      <h2>5. Data retention &amp; deletion</h2>
      <p>
        We keep your data while your account is active. You can disconnect Search Console at any time, which deletes the
        stored access tokens. To delete your account and associated data, contact us at the address below.
      </p>

      <h2>6. Security</h2>
      <p>
        Passwords are hashed with bcrypt, sessions are signed and stored in secure HTTP-only cookies, connections use
        HTTPS, and access tokens are stored in our database. No system is perfectly secure, but we take reasonable
        measures to protect your data.
      </p>

      <h2>7. Your rights</h2>
      <p>
        You may request access to, correction of, or deletion of your personal data, and you may disconnect any
        integration at any time. Contact us to exercise these rights.
      </p>

      <h2>8. Children</h2>
      <p>The Service is not directed to children under 16, and we do not knowingly collect their data.</p>

      <h2>9. Changes</h2>
      <p>We may update this policy; material changes will be reflected by the &quot;Last updated&quot; date above.</p>

      <h2>10. Contact</h2>
      <p>Questions about this policy? Email <a href="mailto:team@trypopulr.in">team@trypopulr.in</a>.</p>

      <div className="note">
        This document is a good-faith template for an early-stage product and is not legal advice. Have it reviewed by a
        qualified professional before relying on it for a commercial launch.
      </div>

      <div className="legal-foot">
        <a href="/">Home</a>
        <a href="/terms">Terms of Service</a>
        <a href="mailto:team@trypopulr.in">Contact</a>
      </div>
    </div>
  );
}
